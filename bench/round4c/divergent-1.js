// small utility module
export function foo() {
  console.log("[divergent-1] foo()");
  return 1;
}

export function bar() {
  return foo() + 1;
}
