const percent = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

/** A 0–1 chance with up to 2 decimals; "<0.01%" and ">99.99%" never round to 0% or 100%. */
export function chanceText(chance: number) {
  const value = chance * 100;
  if (value > 0 && value < 0.01) return "<0.01%";
  if (value > 99.99 && value < 100) return ">99.99%";
  return `${percent.format(value)}%`;
}
