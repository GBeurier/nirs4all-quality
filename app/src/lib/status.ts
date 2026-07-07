// The dataset's lifecycle STATUS, derived from its real state, so the tech always
// knows where they are in the loop and what to do next. Drives the status card +
// the "next step" hint in the workflow rail.
export type Stage = 'empty' | 'precalibration' | 'ready' | 'calibrated' | 'enrichment';

export interface StatusInfo {
  stage: Stage;
  label: { fr: string; en: string };
  hint: { fr: string; en: string };
  tone: 'muted' | 'amber' | 'teal' | 'green';
  /** the step the app recommends the tech go to next */
  recommendedStep: string;
  nRef: number;
  nPool: number;
  hasModel: boolean;
}

const MIN_CAL = 8; // minimum references to calibrate

export function deriveStatus(params: { nSamples: number; nRef: number; nPool: number; hasModel: boolean }): StatusInfo {
  const { nSamples, nRef, nPool, hasModel } = params;
  const base = { nRef, nPool, hasModel };

  if (nSamples === 0) {
    return { ...base, stage: 'empty', tone: 'muted', recommendedStep: 'explore',
      label: { fr: 'Aucune donnée', en: 'No data' },
      hint: { fr: 'Chargez des spectres pour commencer.', en: 'Load spectra to get started.' } };
  }
  if (!hasModel && nRef < MIN_CAL) {
    return { ...base, stage: 'precalibration', tone: 'amber', recommendedStep: nPool > 0 ? 'select' : 'explore',
      label: { fr: 'Pré-calibration', en: 'Pre-calibration' },
      hint: {
        fr: `${nRef}/${MIN_CAL} références. Choisissez quels spectres envoyer à l’HPLC (sous-échantillonnage) puis saisissez les y.`,
        en: `${nRef}/${MIN_CAL} references. Pick which spectra to send to HPLC (subsampling), then enter the y values.`,
      } };
  }
  if (!hasModel && nRef >= MIN_CAL) {
    return { ...base, stage: 'ready', tone: 'teal', recommendedStep: 'calibrate',
      label: { fr: 'Prêt à calibrer', en: 'Ready to calibrate' },
      hint: { fr: `${nRef} références disponibles — lancez la calibration.`, en: `${nRef} references available — run the calibration.` } };
  }
  // has a model: enrichment possible if there is still an un-referenced pool
  if (hasModel && nPool > 0) {
    return { ...base, stage: 'enrichment', tone: 'green', recommendedStep: 'predict',
      label: { fr: 'Calibré · enrichissement', en: 'Calibrated · enrichment' },
      hint: {
        fr: `Modèle en place. Prédisez en routine ; ${nPool} spectre(s) sans y peuvent encore enrichir le modèle.`,
        en: `Model in place. Predict routinely; ${nPool} spectrum(s) without y can still enrich the model.`,
      } };
  }
  return { ...base, stage: 'calibrated', tone: 'green', recommendedStep: 'predict',
    label: { fr: 'Calibré · production', en: 'Calibrated · production' },
    hint: { fr: 'Modèle en place — prédisez en routine et surveillez la dérive.', en: 'Model in place — predict routinely and watch for drift.' } };
}

export const STAGE_TONE: Record<StatusInfo['tone'], { dot: string; text: string; bg: string }> = {
  muted: { dot: 'var(--muted-foreground)', text: 'text-muted-foreground', bg: 'bg-muted' },
  amber: { dot: 'var(--warning)', text: 'text-warning', bg: 'bg-warning/10' },
  teal: { dot: 'var(--primary)', text: 'text-primary', bg: 'bg-primary/10' },
  green: { dot: 'var(--success)', text: 'text-success', bg: 'bg-success/10' },
};
