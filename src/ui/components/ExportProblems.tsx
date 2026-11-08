import React from 'react';
import { ExportProblem } from '../../types';

const SHOWN = 6;

/**
 * Tokens whose `$value` doesn't match their `$type`. Shown on both export tabs, above the
 * actions, because the failure it guards against is an export that *looks* complete: the
 * 2026-11 export shipped 249 raw API objects in place of colours with nothing on screen to say so.
 */
export function ExportProblems({ problems }: { problems: ExportProblem[] }) {
  if (problems.length === 0) return null;

  return (
    <div className="status-banner error" role="alert">
      <strong>
        {problems.length} token{problems.length === 1 ? '' : 's'} exported without a usable value
      </strong>
      <p>
        These are written as empty rather than guessed at. Usually Figma has changed a value
        format — run the Diagnostics tab and share its report.
      </p>
      <ul>
        {problems.slice(0, SHOWN).map((p) => (
          <li key={`${p.fileName}:${p.tokenPath}`}>
            <code>{p.tokenPath}</code> ({p.fileName}): {p.reason}
          </li>
        ))}
      </ul>
      {problems.length > SHOWN && <p>…and {problems.length - SHOWN} more. The full list is in “Copy Full Payload” under meta.problems.</p>}
    </div>
  );
}
