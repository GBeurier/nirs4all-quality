// Host-provided icon maps for the nirs4all-ui `lab` components. The lab package
// is icon-agnostic (it emits icon TOKENS); the app maps those tokens to concrete
// lucide nodes here. Keep the maps total so no token renders blank.
import {
  AlertTriangle,
  Ban,
  Check,
  FlaskConical,
  Inbox,
  RefreshCw,
  Sparkles,
  Waves,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';

const sz = 16;

export const decisionIcons: Record<'check' | 'alert' | 'ban' | 'sparkles', ReactNode> = {
  check: <Check size={sz} />,
  alert: <AlertTriangle size={sz} />,
  ban: <Ban size={sz} />,
  sparkles: <Sparkles size={sz} />,
};

export const healthIcons: Record<'check' | 'alert' | 'ban', ReactNode> = {
  check: <Check size={sz} />,
  alert: <AlertTriangle size={sz} />,
  ban: <Ban size={sz} />,
};

// keyed by the worklist SafetyFlag union ('safe' | 'verify'), not the icon token
export const safetyIcons: Record<'safe' | 'verify', ReactNode> = {
  safe: <Check size={sz} />,
  verify: <AlertTriangle size={sz} />,
};

export const sampleStatusIcons: Record<
  'inbox' | 'waveform' | 'refresh' | 'flask' | 'check' | 'x',
  ReactNode
> = {
  inbox: <Inbox size={sz} />,
  waveform: <Waves size={sz} />,
  refresh: <RefreshCw size={sz} />,
  flask: <FlaskConical size={sz} />,
  check: <Check size={sz} />,
  x: <X size={sz} />,
};
