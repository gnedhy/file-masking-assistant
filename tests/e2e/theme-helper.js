const LABELS = { light: "浅色", dark: "深色", system: "跟随系统" };

// Opens the header theme menu and picks an option by its stored value.
export async function chooseTheme(page, value) {
  await page.getByRole("button", { name: "界面颜色模式", exact: true }).click();
  await page.getByRole("menuitemradio", { name: LABELS[value], exact: true }).click();
}
