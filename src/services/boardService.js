export async function applyBoardValues(entries) {
  if (entries.length === 0) return { ok: true, saved: false, results: [] };
  const result = await window.cats.board.applyConfig(entries);
  if (result?.ok) return result;

  const failed = result?.results?.find(
    ({ status }) => !["verified", "pending"].includes(status),
  );
  const detail = failed
    ? `${failed.key}: ${failed.message || failed.status}`
    : "The board did not verify the transaction.";
  throw new Error(`Configuration was not fully applied. ${detail}`);
}
