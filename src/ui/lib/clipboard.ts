/**
 * Figma renders plugin UI inside a sandboxed iframe with no clipboard permission grant,
 * so `navigator.clipboard.writeText` silently rejects there even though it works fine in
 * a regular browser tab. `execCommand('copy')` on a hidden textarea is the fallback that
 * actually works inside that sandbox.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the execCommand fallback below
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let succeeded = false;
  try {
    succeeded = document.execCommand('copy');
  } catch {
    succeeded = false;
  }

  document.body.removeChild(textarea);
  return succeeded;
}
