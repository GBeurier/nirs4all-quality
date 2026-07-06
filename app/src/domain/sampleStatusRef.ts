// Local mirror of the sample-lifecycle union owned by `nirs4all-ui/lab`
// (src/lab/sampleStatus.ts). Kept local so the domain model type-checks
// standalone. MUST stay identical to the shared contract; once the
// `nirs4all-ui/lab` subpath export is wired, replace this file's body with:
//   export type { SampleStatus } from 'nirs4all-ui/lab';
export type SampleStatus =
  | 'received'
  | 'nirs_measured'
  | 'to_remeasure'
  | 'sent_hplc'
  | 'integrated'
  | 'excluded';
