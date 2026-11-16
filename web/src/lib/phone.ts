// Israeli mobile numbers: 05X-XXXXXXX, also accepts +972 / 972 / spaces / dashes.

export function normalizeIlMobile(input: string): string | null {
  let d = input.replace(/[\s\-().]/g, "");
  if (d.startsWith("+972")) d = "0" + d.slice(4);
  else if (d.startsWith("00972")) d = "0" + d.slice(5);
  else if (d.startsWith("972")) d = "0" + d.slice(3);
  if (!/^05\d{8}$/.test(d)) return null;
  return `${d.slice(0, 3)}-${d.slice(3)}`;
}
