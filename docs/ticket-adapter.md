# Ticket adapter interface, v1

sign-off shows and edits tickets through one adapter: an executable that speaks this interface in front of whatever backend holds the tickets. The backend is the source of truth. sign-off keeps no ticket data of its own, no file and no cache, holds no rules about tickets, and never names a backend, a status word or a label convention. Any backend that implements this document works with it.

Status: v1, frozen. The board reads and writes its tickets only through this adapter. A change a client or an adapter could notice is a new interface number, never an edit of v1; a client refuses an adapter that answers another number.

The interface has four parts, all in this repository: this document, a [JSON Schema](ticket-adapter/schemas) for every request and response, [worked examples](ticket-adapter/examples) that the schemas accept, and the [conformance script](../test/ticket-adapter-conformance.mjs), which runs any adapter against them. When the document and the script disagree, the script is right and the document is a bug.

The words in the examples (`stage-1`, `kind-a`, `alpha`) are made up. The interface gives no word of any field a meaning.

## 1. Transport

- One executable, named by the environment variable `SIGN_OFF_TICKETS_ADAPTER`, called as `adapter <operation>`, once per operation.
- One JSON request on stdin, then end of input. One JSON response on stdout and nothing else; diagnostics go to stderr.
- Exit 0 with a success response, non-zero with an error response ([section 6](#6-errors)). A client reads the exit status first, then stdout.
- The adapter inherits the client's environment and configures itself from variables of its own; the interface defines none. With no executable named, a client says so. It never falls back to a store of its own.
- A client that stops waiting kills the adapter and shows `timeout` itself; one whose adapter exits without a valid response shows `internal` with whatever came on stderr. A write may or may not have landed, so the client reads again, and a retry that repeats the `op_id` is safe ([section 5](#5-edits-are-patches)).
- No network transport in v1. One could be added without changing a record.

## 2. Requests and responses

Every request is one JSON object carrying `"interface": 1` and the keys of its operation, and nothing else: an unknown key, or another interface number, is refused with `unsupported`. The operation comes from the command line, not the body. Responses carry only the keys shown below. Two things are open on purpose, the ticket record and the event record (a key they do not name is kept) and the `extra` object inside them.

## 3. The ticket record

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Opaque, stable, never reused. A card on the board refers to a ticket by it. |
| `rev` | string | Opaque. It changes whenever any other field of the record changes; it need not change for a history event that leaves the record as it was. A client compares it for equality and sends it back, nothing else. |
| `title`, `body` | string | The summary and the long text. `body` may be empty. |
| `kind`, `status` | string | The backend's own words. `describe` may give each a display label and the allowed values; the client invents no vocabulary and ranks no word. |
| `assignee` | string or null | Who has it. |
| `labels` | array of strings | Any strings, in the backend's order. |
| `parent` | string or null | The `id` of the ticket this one sits under. |
| `links` | array of `{ type, id }` | Other tickets this one is linked to. `type` is the backend's own word. A link may carry more keys; they are kept. |
| `created_at`, `updated_at` | string | RFC 3339 times. |
| `extra` | object | Everything else the backend has, as it has it ([section 8](#8-unknown-fields-are-shown-and-kept)). |

A client draws `title`, `body`, `kind`, `status`, `assignee`, `labels`, `parent` and `links` and nothing else of its own. A group of tickets is a ticket that others name as `parent`; grouping and the counts of a group are worked out from `parent` and `status` over the list just read. There is no progress field. A backend with another notion of progress puts it in `extra`.

```json example get
{
  "operation": "get",
  "about": "One ticket. The extra block carries a key the client has never heard of; it is shown and kept.",
  "request": { "interface": 1, "id": "tk-1004" },
  "response": {
    "ticket": {
      "id": "tk-1004",
      "rev": "r-9001",
      "title": "Write the release note",
      "body": "Two lines.",
      "kind": "kind-a",
      "status": "stage-1",
      "assignee": "Umer",
      "labels": ["alpha", "beta"],
      "parent": null,
      "links": [],
      "created_at": "2026-11-13T09:00:00Z",
      "updated_at": "2026-11-13T09:00:00Z",
      "extra": { "legacy-ref": "L-17", "estimate": "3" }
    }
  },
  "exit": 0
}
```

## 4. Operations

| Operation | Request keys | Response keys |
| --- | --- | --- |
| `describe` | none | `interface`, `backend`, `capabilities`, `fields` |
| `list` | `cursor`, `limit` | `tickets`, `next_cursor`, `complete` |
| `get` | `id` | `ticket` |
| `create` | `ticket`, `op_id` | `ticket` |
| `update` | `id`, `rev`, `set`, `unset`, `op_id` | `ticket` |
| `history` | `id`, `cursor` | `events`, `next_cursor` |
| `comment` | `id`, `text`, `op_id` | `event` |

Every request also carries `interface`. `describe` takes nothing else and is the one response that carries `interface`. There is no delete in v1.

**`describe`** names the backend, lists its `capabilities` and its `fields`. `history` and `comment` are the capabilities of v1; a backend without one answers that operation with `unsupported`. Each entry of `fields` has a `name` (a record field, or `extra.<key>` for a key of `extra` the backend knows), a `type` (`string`, `text`, `enum`, `set`, `ref`, `links` or `datetime`) and optionally a `label`, `values`, `required` and `readonly`. For an `enum` the `values` are the only allowed words; for any other type they are suggestions. The New ticket sheet and the filters are drawn from this list, not from constants in the client.

```json example describe
{
  "operation": "describe",
  "about": "The backend names itself, says which optional operations it has and lists the fields it knows. The New ticket sheet and the filters are drawn from this.",
  "request": { "interface": 1 },
  "response": {
    "interface": 1,
    "backend": "example",
    "capabilities": ["history", "comment"],
    "fields": [
      { "name": "title", "type": "string", "label": "Title", "required": true },
      { "name": "body", "type": "text", "label": "Description" },
      {
        "name": "kind",
        "type": "enum",
        "label": "Kind",
        "values": [{ "value": "kind-a", "label": "Kind A" }, { "value": "kind-b", "label": "Kind B" }]
      },
      {
        "name": "status",
        "type": "enum",
        "label": "Stage",
        "values": [
          { "value": "stage-1", "label": "Stage one" },
          { "value": "stage-2" },
          { "value": "stage-3", "label": "Stage three" }
        ]
      },
      { "name": "assignee", "type": "string", "label": "Assignee", "values": [{ "value": "Umer" }] },
      { "name": "labels", "type": "set", "label": "Labels" },
      { "name": "parent", "type": "ref", "label": "Parent" },
      { "name": "links", "type": "links" },
      { "name": "created_at", "type": "datetime", "readonly": true },
      { "name": "updated_at", "type": "datetime", "readonly": true },
      { "name": "extra.estimate", "type": "string", "label": "Estimate" }
    ]
  },
  "exit": 0
}
```

**`list`** returns tickets, a page at a time. `limit` is a maximum; the adapter may return fewer. Pages follow `next_cursor` until it is absent, in one stable order. See [section 7](#7-a-list-is-whole-or-it-is-an-error) for `complete`.

```json example list
{
  "operation": "list",
  "about": "Two tickets of a longer list. Following next_cursor until it is absent reads the rest; every page says complete.",
  "request": { "interface": 1, "limit": 2 },
  "response": {
    "tickets": [
      {
        "id": "tk-1003",
        "rev": "r-8770",
        "title": "Fix the export",
        "body": "",
        "kind": "kind-b",
        "status": "stage-2",
        "assignee": null,
        "labels": [],
        "parent": "tk-1001",
        "links": [{ "type": "related", "id": "tk-1004" }],
        "created_at": "2026-11-12T16:00:00Z",
        "updated_at": "2026-11-13T08:10:00Z",
        "extra": {}
      },
      {
        "id": "tk-1004",
        "rev": "r-9001",
        "title": "Write the release note",
        "body": "Two lines.",
        "kind": "kind-a",
        "status": "stage-1",
        "assignee": "Umer",
        "labels": ["alpha", "beta"],
        "parent": null,
        "links": [],
        "created_at": "2026-11-13T09:00:00Z",
        "updated_at": "2026-11-13T09:00:00Z",
        "extra": { "legacy-ref": "L-17", "estimate": "3" }
      }
    ],
    "next_cursor": "c-2",
    "complete": true
  },
  "exit": 0
}
```

**`get`** returns one ticket, or `not_found`.

**`create`** takes the fields of a ticket without `id`, `rev`, `created_at` and `updated_at`, which the backend assigns. Only `title` is required by the interface; a field left out takes the backend's default, and a backend that needs more answers `invalid` naming it. The answer is the ticket read back from the backend, not the request echoed.

```json example create
{
  "operation": "create",
  "about": "The backend assigns id, rev and both times, and answers with the ticket as it read it back.",
  "request": {
    "interface": 1,
    "ticket": {
      "title": "Write the release note",
      "body": "Two lines.",
      "kind": "kind-a",
      "status": "stage-1",
      "assignee": "Umer",
      "labels": ["alpha", "beta"],
      "extra": { "legacy-ref": "L-17", "estimate": "3" }
    },
    "op_id": "op-create-0001"
  },
  "response": {
    "ticket": {
      "id": "tk-1004",
      "rev": "r-9001",
      "title": "Write the release note",
      "body": "Two lines.",
      "kind": "kind-a",
      "status": "stage-1",
      "assignee": "Umer",
      "labels": ["alpha", "beta"],
      "parent": null,
      "links": [],
      "created_at": "2026-11-13T09:00:00Z",
      "updated_at": "2026-11-13T09:00:00Z",
      "extra": { "legacy-ref": "L-17", "estimate": "3" }
    }
  },
  "exit": 0
}
```

**`update`** is [section 5](#5-edits-are-patches). **`history`** and **`comment`** are [section 9](#9-history).

## 5. Edits are patches

`update` sends only what the person changed, and the `rev` they read:

- `set` is an object of the fields to assign: `title`, `body`, `kind`, `status`, `assignee`, `labels`, `parent`, `links` and `extra`. Each field is assigned whole (`labels` is the new list). `extra` is merged key by key: the keys given are set, every other key stays. `null` is a value, so `{ "assignee": null }` clears the assignee. `id`, `rev`, `created_at` and `updated_at` are not the client's to set.
- `unset` is an array of keys to remove from `extra`. It exists because `null` in `set.extra` is a value, not a removal. A key named in both `set.extra` and `unset` is `invalid`.
- `rev` is compare-and-set. The adapter checks it and writes as one step. If it is not the record's current `rev`, nothing is written and the answer is `conflict` carrying the current ticket in `detail.current`; the client shows both and keeps what the person typed.
- Nothing is rewritten from the client's copy. A field, a label or an `extra` key the patch does not name is not read, not sent and not touched, so it cannot be lost or overwritten by a client that does not know it.
- An update that names nothing (no `set` and no `unset`, or an empty `set`) is `invalid`. A client that has no change makes no call.
- The answer is the ticket read back, with its new `rev`.

`op_id` is a key the client chooses for one write (up to 128 characters), on `create`, `update` and `comment`. The adapter remembers the answer of each `op_id` for at least 24 hours. The same request repeated returns the first answer without writing again, and without comparing `rev`, so a retry after a lost answer never doubles a create or conflicts with its own first success. The same `op_id` on another request is `invalid`, naming `op_id`.

```json example update
{
  "operation": "update",
  "about": "A patch: only the title, the status and one extra key are sent. The extra key the client does not know (legacy-ref) is not mentioned and comes back unchanged.",
  "request": {
    "interface": 1,
    "id": "tk-1004",
    "rev": "r-9001",
    "op_id": "op-update-0001",
    "set": { "title": "Write the 0.11 release note", "status": "stage-2", "extra": { "estimate": "5" } }
  },
  "response": {
    "ticket": {
      "id": "tk-1004",
      "rev": "r-9002",
      "title": "Write the 0.11 release note",
      "body": "Two lines.",
      "kind": "kind-a",
      "status": "stage-2",
      "assignee": "Umer",
      "labels": ["alpha", "beta"],
      "parent": null,
      "links": [],
      "created_at": "2026-11-13T09:00:00Z",
      "updated_at": "2026-11-13T09:30:00Z",
      "extra": { "legacy-ref": "L-17", "estimate": "5" }
    }
  },
  "exit": 0
}
```

```json example update-unset
{
  "operation": "update",
  "about": "unset removes a key from extra, which set cannot express because null is a value.",
  "request": { "interface": 1, "id": "tk-1004", "rev": "r-9002", "op_id": "op-update-0002", "unset": ["estimate"] },
  "response": {
    "ticket": {
      "id": "tk-1004",
      "rev": "r-9003",
      "title": "Write the 0.11 release note",
      "body": "Two lines.",
      "kind": "kind-a",
      "status": "stage-2",
      "assignee": "Umer",
      "labels": ["alpha", "beta"],
      "parent": null,
      "links": [],
      "created_at": "2026-11-13T09:00:00Z",
      "updated_at": "2026-11-13T09:45:00Z",
      "extra": { "legacy-ref": "L-17" }
    }
  },
  "exit": 0
}
```

```json example update-conflict
{
  "operation": "update",
  "about": "The rev the client read is stale. Nothing was written; the error carries the ticket as it is now.",
  "request": { "interface": 1, "id": "tk-1004", "rev": "r-9001", "op_id": "op-update-0003", "set": { "assignee": null } },
  "response": {
    "error": {
      "code": "conflict",
      "message": "tk-1004 changed since it was read (rev r-9001, now r-9002).",
      "retryable": false,
      "detail": {
        "current": {
          "id": "tk-1004",
          "rev": "r-9002",
          "title": "Write the 0.11 release note",
          "body": "Two lines.",
          "kind": "kind-a",
          "status": "stage-2",
          "assignee": "Umer",
          "labels": ["alpha", "beta"],
          "parent": null,
          "links": [],
          "created_at": "2026-11-13T09:00:00Z",
          "updated_at": "2026-11-13T09:30:00Z",
          "extra": { "legacy-ref": "L-17", "estimate": "5" }
        }
      }
    }
  },
  "exit": 1
}
```

## 6. Errors

Every failure is `{ "error": { "code", "message", "retryable", "detail"? } }` on stdout with a non-zero exit. `message` is for a person and is shown as written, with the code. `retryable` says whether trying the same request again can succeed.

| Code | When | `detail` |
| --- | --- | --- |
| `unavailable` | The backend cannot be reached or read. | optional |
| `timeout` | The backend or the adapter did not answer in time. | optional |
| `not_found` | No ticket has the `id` asked for. | optional |
| `conflict` | The `rev` sent is not current. | required: `current`, the ticket now |
| `invalid` | The request or a value in it is refused. | required: `fields`, a list of `{ field, message }` naming every field at fault; a body that is not one JSON object names `request` |
| `denied` | The backend does not allow it. | optional |
| `unsupported` | An operation, request key or interface number the adapter does not have, or a capability it did not list. | optional |
| `incomplete` | A `list` that cannot be whole ([section 7](#7-a-list-is-whole-or-it-is-an-error)). | optional |
| `internal` | The adapter failed in a way that is not the request's fault. | optional |

A client shows the message with its code and a Retry button. It never shows an empty list, or older rows, in place of an error: it has no cache and no stale-or-empty fallback. A form refused with `invalid` keeps every word the person typed and marks the fields named.

A backend write that takes several steps is the adapter's to make atomic or to reconcile. It answers with the real final state, or with an error, never with a success that did not happen.

```json example error-unavailable
{
  "operation": "list",
  "about": "A read that failed is this, with a non-zero exit. It is never an empty list.",
  "request": { "interface": 1 },
  "response": {
    "error": { "code": "unavailable", "message": "The ticket store could not be read: connection refused.", "retryable": true }
  },
  "exit": 1
}
```

```json example error-invalid
{
  "operation": "create",
  "about": "detail.fields names every field at fault, so a form keeps every word and marks the field.",
  "request": { "interface": 1, "ticket": { "title": "Write the release note", "status": "stage-9" }, "op_id": "op-create-0002" },
  "response": {
    "error": {
      "code": "invalid",
      "message": "The ticket was refused.",
      "retryable": false,
      "detail": { "fields": [{ "field": "status", "message": "stage-9 is not one of stage-1, stage-2, stage-3" }] }
    }
  },
  "exit": 1
}
```

```json example error-not-found
{
  "operation": "get",
  "request": { "interface": 1, "id": "tk-9999" },
  "response": { "error": { "code": "not_found", "message": "No ticket tk-9999.", "retryable": false } },
  "exit": 1
}
```

```json example error-unsupported
{
  "operation": "history",
  "about": "An operation the backend does not have, a request key it does not know or a different interface number.",
  "request": { "interface": 1, "id": "tk-1004" },
  "response": { "error": { "code": "unsupported", "message": "This backend keeps no history.", "retryable": false } },
  "exit": 1
}
```

## 7. A list is whole or it is an error

`complete` is true only when every ticket the backend holds was returned. Every page carries it and it speaks for the whole read: true means that reading from the first page until `next_cursor` is absent gives every ticket. An adapter that cannot return every ticket (a part of the store unreadable, a read cut short, a page it cannot vouch for) answers the error `incomplete`. It never answers a short list as a success, and never `complete: false` with tickets. A client treats a list response whose `complete` is not `true` as `incomplete`: it refuses it and shows the error, not the tickets. The conformance script does the same.

```json example error-incomplete
{
  "operation": "list",
  "about": "A list that cannot be whole is this error, not a short list.",
  "request": { "interface": 1 },
  "response": {
    "error": {
      "code": "incomplete",
      "message": "Only part of the ticket store could be read (2 of 40 tickets).",
      "retryable": true
    }
  },
  "exit": 1
}
```

## 8. Unknown fields are shown and kept

An adapter puts everything the backend has beyond the named fields in `extra`, each under its own key, with the value and the order the backend gave it. It interprets none of it. It accepts any key in `create` and in `set.extra`, and it never drops one: a backend that cannot carry a key answers `invalid` naming it.

A client lists every key and value of `extra`, and every top-level key it does not know, in a More fields block of the ticket sheet. It never interprets, reorders or reserialises a value it does not edit, and an edit of another field leaves them untouched, because an edit is a patch.

## 9. History

`history` returns every event the backend recorded for the ticket, oldest first, a page at a time. An event:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Opaque, unique within the ticket's events. |
| `at` | string | RFC 3339 time. |
| `actor` | string or null | Who did it. |
| `type` | string | The backend's own word for what happened. |
| `text` | string or null | A comment's words, or a one-line summary. |
| `changes` | array of `{ field, from, to }` | What changed, by record field or `extra.<key>`; empty when the backend does not say. |
| `extra` | object | Anything else the backend recorded about the event. |

The ticket sheet and Activity read this and invent no event from the current rows. A backend that keeps no history leaves `history` out of `capabilities`, and the client says so: this backend keeps no history.

`comment` adds a comment event to the ticket and answers it. Only a backend whose `capabilities` list `comment` has it.

```json example history
{
  "operation": "history",
  "about": "Every event the backend recorded for the ticket, oldest first. The words in type are the backend's own.",
  "request": { "interface": 1, "id": "tk-1004" },
  "response": {
    "events": [
      {
        "id": "e-1",
        "at": "2026-11-13T09:00:00Z",
        "actor": "Umer",
        "type": "created",
        "text": null,
        "changes": [],
        "extra": {}
      },
      {
        "id": "e-2",
        "at": "2026-11-13T09:30:00Z",
        "actor": "Umer",
        "type": "changed",
        "text": null,
        "changes": [
          { "field": "title", "from": "Write the release note", "to": "Write the 0.11 release note" },
          { "field": "status", "from": "stage-1", "to": "stage-2" },
          { "field": "extra.estimate", "from": "3", "to": "5" }
        ],
        "extra": {}
      }
    ]
  },
  "exit": 0
}
```

```json example comment
{
  "operation": "comment",
  "about": "Only a backend that lists comment in its capabilities has this operation.",
  "request": { "interface": 1, "id": "tk-1004", "text": "Needs a screenshot.", "op_id": "op-comment-0001" },
  "response": {
    "event": {
      "id": "e-3",
      "at": "2026-11-13T10:00:00Z",
      "actor": "Umer",
      "type": "comment",
      "text": "Needs a screenshot.",
      "changes": [],
      "extra": {}
    }
  },
  "exit": 0
}
```

## 10. Conformance

```text
node test/ticket-adapter-conformance.mjs <adapter> --throwaway --faults <driver>
```

The script runs the adapter against the worked examples and checks every answer against its schema, then the rules a schema cannot hold: a created ticket reads back with its unknown `extra` key; a patch changes only what it names; an unknown field survives an update of another field; a stale `rev` gives `conflict` with the current ticket and writes nothing; a repeated `op_id` answers its first result; a bad request is `invalid` naming its field; an unknown operation, key or interface is `unsupported`; a list is whole, pages join up, and `complete: false` is refused as incomplete; history is in order; a failed read is an error and never an empty list.

It creates and edits tickets and the interface cannot delete them, so it refuses to run without `--throwaway`: point the adapter at a backend you can throw away. `--faults` names the backend's own driver, called as `driver none`, `driver unreadable` or `driver partial`: after `unreadable` every read of the backend fails, after `partial` a list can be read only in part, and `none` puts it right. Without a driver the two failure checks cannot run, and the script says so and exits 3. Exit 0 means every check passed, 1 that one failed, 2 a bad command line.

`test/support/ticket-adapter-standin.mjs` is a small adapter that keeps every rule, with its driver `ticket-adapter-standin-faults.mjs`; `test/ticket-adapter.test.mjs` runs the script against it, and against copies that each break one rule to show the script catches each.

## 11. Files

| Path | What |
| --- | --- |
| `docs/ticket-adapter/schemas/` | One schema per request and response (`<operation>.request.json`, `<operation>.response.json`), `error.json` for every failure, `ticket.json`, `event.json` and `common.json` for the shared pieces. JSON Schema 2020-12; the files refer to each other by name. |
| `docs/ticket-adapter/examples/` | One file per worked example, `{ operation, request, response, exit }`, and the `invalid-*` files, each breaking one rule and refused by its schema. |
| `test/ticket-adapter-conformance.mjs` | The conformance script. |
| `test/ticket-adapter.test.mjs` | Its tests: the schemas against the examples, this document against both, the script against the stand-in. |
