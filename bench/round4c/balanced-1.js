// small utility module
export function foo() {
  return 1;
}

export function bar() {
  console.log('[bar] called');
  return foo() + 1;
}
