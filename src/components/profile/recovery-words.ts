interface ClipboardWriter {
  writeText(value: string): Promise<void>;
}

export type RecoveryCopyStatus = 'success' | 'error';

export function recoveryWordsIssuanceKey(words: readonly string[]): string {
  return words.join('\u001f');
}

export async function copyRecoveryWords(
  words: readonly string[],
  clipboard: ClipboardWriter | undefined,
): Promise<RecoveryCopyStatus> {
  if (!clipboard) return 'error';
  try {
    await clipboard.writeText(words.join(' '));
    return 'success';
  } catch {
    return 'error';
  }
}
