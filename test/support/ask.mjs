// Every new question needs a why, an outcome per option, a recommendation with its reason and a silent default.
// Tests about something else get them here; a test that passes --why writes the rest by hand too.
export function asked(args) {
  if ((args[0] === 'raise' || args[0] === 'post' && (!args.includes('--type') || args[args.indexOf('--type') + 1] === 'decision')) && !args.includes('--kind') && !args.includes('--ask-ref')) args = [...args, '--ask-ref', 'message-test'];
  const has = (flag) => args.includes(flag), type = has('--type') ? args[args.indexOf('--type') + 1] : 'decision';
  if (!(args[0] === 'raise' || (args[0] === 'post' && type === 'decision')) || !has('--title') || has('--from') || has('--why')) return args;
  const options = args.flatMap((a, i) => (args[i - 1] === '--option' ? [a.split('=')[0]] : []));
  const recommend = has('--recommend') ? args[args.indexOf('--recommend') + 1] : (options[0] ?? 'yes');
  return [...args, '--why', 'Umer needs an answer before the release.',
    ...(has('--outcome') ? [] : (options.length ? options : ['yes', 'no']).flatMap((v) => ['--outcome', `${v}=The work goes on with ${v}.`])),
    ...(has('--recommend') ? [] : ['--recommend', recommend]),
    ...(has('--recommend-reason') ? [] : ['--recommend-reason', 'It is the safe choice.']),
    ...(has('--default') ? [] : ['--default', recommend])];
}
