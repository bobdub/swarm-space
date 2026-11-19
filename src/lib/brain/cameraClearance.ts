/** First-person eyes follow solved body height; only an active boom needs rescue. */
export function needsBoomClearance(boom: number, spectator: number, third: number): boolean {
  return boom > 0 || spectator > 0 || third > 0;
}