import { useEffect, useMemo, useState } from 'react';
import type { SpectraDataset } from '@/domain/spectra';
import { applyPreviewPp, PREVIEW_PP } from './preview';

type PreviewStatus = 'raw' | 'processing' | 'ready' | 'unavailable';
interface SettledPreview {
  key: object;
  spectra: SpectraDataset;
  status: 'ready' | 'unavailable';
  reason?: string;
}

/** Key by project, memoized cropped identity and option, never by matrix scans. */
export function usePreviewSpectra(projectId: string, raw: SpectraDataset | undefined, option: string) {
  const key = useMemo(() => ({}), [projectId, raw, option]);
  const [settled, setSettled] = useState<SettledPreview>();
  useEffect(() => {
    if (!raw || option === 'none') return;
    let active = true;
    void applyPreviewPp(raw, option).then(
      (spectra) => { if (active) setSettled({ key, spectra, status: 'ready' }); },
      (error: unknown) => {
        if (active) setSettled({ key, spectra: raw, status: 'unavailable', reason: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => { active = false; };
  }, [key, raw, option]);

  // Effects run after render: gate the stored value here as well as at settlement.
  const current = settled?.key === key ? settled : undefined;
  const status: PreviewStatus = !raw || option === 'none' ? 'raw' : current?.status ?? 'processing';
  const spectra = status === 'ready' ? current!.spectra : raw;
  const label = status === 'raw' ? 'Raw'
    : status === 'processing' ? 'Raw — preview processing'
    : status === 'unavailable' ? 'Raw — preview processing unavailable'
    : `${PREVIEW_PP.find((pp) => pp.id === option)!.en} — preview`;
  const description = status === 'ready' && (option === 'msc' || option === 'std')
    ? 'Descriptive preview fitted on all displayed repetitions; not a calibration model.'
    : status === 'ready' && (option === 'd1' || option === 'd2')
      ? 'Derivative per band index (delta = 1), not per physical-axis unit.' : undefined;
  return { spectra, status, label, description, reason: current?.reason };
}
