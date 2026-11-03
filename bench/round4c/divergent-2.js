// small utility module
export function foo() {
  console.log('[foo] called');
  return 1;
}

export function bar() {
  return foo() + 1;
}
