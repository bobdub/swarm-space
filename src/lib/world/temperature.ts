/** Convert degrees Fahrenheit to degrees Celsius. */
export function fahrenheitToCelsius(tempF: number): number {
  return ((tempF - 32) * 5) / 9;
}
