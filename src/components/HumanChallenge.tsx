import React from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import type { HumanChallengeData } from '../lib/security';

interface HumanChallengeProps {
  challenge: HumanChallengeData;
  value: string;
  onChange: (value: string) => void;
  onRefresh: () => void;
  hasError?: boolean;
  disabled?: boolean;
  idPrefix?: string;
}

export function HumanChallenge({
  challenge,
  value,
  onChange,
  onRefresh,
  hasError = false,
  disabled = false,
  idPrefix = 'human-check',
}: HumanChallengeProps) {
  const inputId = `${idPrefix}-answer`;

  return (
    <div
      className={`p-3 rounded-xl border transition-colors ${
        hasError
          ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800'
          : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/80'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <label
          htmlFor={inputId}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300"
        >
          <ShieldCheck
            className={`w-3.5 h-3.5 ${
              hasError
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-emerald-600 dark:text-emerald-400'
            }`}
            aria-hidden="true"
          />
          Human Verification <span className="text-rose-600 dark:text-rose-400">*</span>
        </label>
        <button
          type="button"
          disabled={disabled}
          onClick={onRefresh}
          title="Get a new verification question"
          aria-label="Get a new verification question"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors disabled:opacity-50"
        >
          <RefreshCw className="w-3 h-3" aria-hidden="true" />
          New question
        </button>
      </div>

      <div className="flex items-center gap-2.5">
        <div
          aria-live="polite"
          className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-sm font-semibold text-slate-900 dark:text-slate-100 select-none shrink-0 tracking-wide"
        >
          {challenge.question} = ?
        </div>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          required
          disabled={disabled}
          aria-invalid={hasError}
          maxLength={4}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9-]/g, ''))}
          placeholder="Answer"
          className={`flex-1 min-w-0 px-3 py-2 text-sm font-mono bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 border rounded-lg focus:border-slate-900 dark:focus:border-slate-400 disabled:opacity-50 ${
            hasError
              ? 'border-rose-400 dark:border-rose-700'
              : 'border-slate-200 dark:border-slate-700'
          }`}
        />
      </div>

      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
        Quick check to protect your family tree from automated bots.
      </p>
    </div>
  );
}
