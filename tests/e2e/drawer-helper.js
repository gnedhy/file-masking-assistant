// The review drawer lists the chosen and suggested columns and folds the rest under "其他 N 列".
// A test that needs one of the folded columns opens the fold first.
export async function openMoreColumns(drawer) {
  const more = drawer.locator(".column-more");
  if (await more.count() && !(await more.evaluate((element) => element.open))) await more.locator("summary").click();
}
