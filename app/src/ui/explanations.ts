// Plain-language explanation intros behind every "?" — bilingual (FR/EN). The
// intro (what / why / takeaway) is here; the real scientific evidence (numbers +
// mini-charts) is passed per-analysis as <children> to <Explain>.
import type { Localized } from '@/i18n';
import type { ExplanationContent } from './Explain';

type E = Localized<ExplanationContent>;

export const EXPLAIN = {
  datasetOverview: {
    fr: {
      title: 'Vue d’ensemble du jeu de données',
      what: 'On affiche vos spectres, la distribution des références, une carte PCA, et la consistance des répétitions.',
      why: 'Avant tout modèle, il faut « voir » ses données : spectres aberrants, gamme de référence déséquilibrée, répétitions incohérentes.',
      takeaway: 'Regardez ces 4 vues avant de calibrer — elles évitent 80 % des mauvaises surprises.',
    },
    en: {
      title: 'Dataset overview',
      what: 'We show your spectra, the reference distribution, a PCA map, and replicate consistency.',
      why: 'Before any model, you must "see" the data: odd spectra, an unbalanced reference range, inconsistent replicates.',
      takeaway: 'Check these 4 views before calibrating — they prevent 80% of bad surprises.',
    },
  },
  spectra: {
    fr: {
      title: 'Graphique des spectres',
      what: 'Chaque échantillon est réduit à la moyenne de ses répétitions. La courbe épaisse est la moyenne générale ; la bande claire est l’enveloppe min–max par longueur d’onde.',
      why: 'Une courbe qui sort franchement de la bande est un spectre atypique (saturation, bulle, mauvais contact) à vérifier.',
      takeaway: 'Cherchez les courbes qui « sortent du troupeau ».',
      methods: ['mean', 'min/max band'],
    },
    en: {
      title: 'Spectra plot',
      what: 'Each sample is reduced to the mean of its replicates. The thick curve is the overall mean; the light band is the per-wavelength min–max envelope.',
      why: 'A curve clearly outside the band is an atypical spectrum (saturation, bubble, poor contact) to check.',
      takeaway: 'Look for the curves that leave the herd.',
      methods: ['mean', 'min/max band'],
    },
  },
  target: {
    fr: {
      title: 'Distribution de la référence',
      what: 'Histogramme des valeurs de référence (les y de la chimie humide) + statistiques (min / moyenne / max / écart-type).',
      why: 'Un modèle ne prédit bien que dans la gamme qu’il a vue. Une gamme étroite ou des trous annoncent des prédictions fragiles.',
      takeaway: 'Une distribution large et régulière = calibration plus robuste.',
      methods: ['histogram(20 bins)'],
    },
    en: {
      title: 'Reference distribution',
      what: 'Histogram of the reference values (the wet-chemistry y) + statistics (min / mean / max / std).',
      why: 'A model only predicts well within the range it has seen. A narrow range or gaps signal fragile predictions.',
      takeaway: 'A wide, even distribution = a more robust calibration.',
      methods: ['histogram(20 bins)'],
    },
  },
  pca: {
    fr: {
      title: 'Carte PCA',
      what: 'La PCA compresse chaque spectre (des centaines de longueurs d’onde) en 2 axes qui capturent le plus de variation. Chaque point est un échantillon, coloré par sa référence.',
      why: 'Elle révèle la structure : groupes, gradients, points isolés. Un point loin des autres est candidat à vérification.',
      details: 'Attention : 2 axes « écrasent » l’information — c’est une aide visuelle, pas une preuve. Les % = part de variation expliquée par chaque axe.',
      takeaway: 'Utile pour repérer des familles d’échantillons et des points isolés.',
      methods: ['PCA (Gram power-iteration)'],
    },
    en: {
      title: 'PCA map',
      what: 'PCA compresses each spectrum (hundreds of wavelengths) into 2 axes capturing the most variation. Each point is a sample, colored by its reference.',
      why: 'It reveals structure: clusters, gradients, isolated points. A point far from the rest is a candidate to check.',
      details: 'Caution: 2 axes "flatten" the information — a visual aid, not proof. The % = share of variation each axis explains.',
      takeaway: 'Useful to spot sample families and isolated points.',
      methods: ['PCA (Gram power-iteration)'],
    },
  },
  repetitions: {
    fr: {
      title: 'Consistance des répétitions',
      what: 'Pour chaque échantillon, distance de chacune de ses répétitions à la moyenne de l’échantillon. Une colonne = un échantillon ; ses répétitions sont empilées.',
      why: 'Deux répétitions du même échantillon devraient être quasi identiques. Une répétition loin des autres (> P95, entourée en orange) signale un problème de mesure.',
      details: 'Les lignes P75/P90/P95 sont les seuils de distance ; au-delà de P95 la répétition est jugée suspecte. Triez par « variance » pour voir les échantillons les moins reproductibles.',
      takeaway: 'Re-mesurez les répétitions suspectes avant de les intégrer.',
      methods: ['distance euclidienne à la moyenne de groupe', 'quantiles P50/75/90/95'],
    },
    en: {
      title: 'Replicate consistency',
      what: 'For each sample, the distance of each replicate to the sample mean. One column = one sample; its replicates are stacked.',
      why: 'Two replicates of the same sample should be nearly identical. A replicate far from the others (> P95, ringed in orange) signals a measurement problem.',
      details: 'The P75/P90/P95 lines are distance thresholds; above P95 the replicate is flagged suspect. Sort by "variance" to see the least reproducible samples.',
      takeaway: 'Re-measure suspect replicates before integrating them.',
      methods: ['euclidean distance to group mean', 'quantiles P50/75/90/95'],
    },
  },
  healthScore: {
    fr: {
      title: 'Score de santé des données',
      what: 'On agrège les constats qualité en une note sur 100 : chaque point bloquant retire 20, chaque avertissement 6.',
      why: 'Une note simple pour décider en un coup d’œil si les données sont prêtes ou s’il faut d’abord corriger.',
      details: 'Règle volontairement simple et explicable — pas de boîte noire. Le détail de chaque constat montre la mesure qui l’a déclenché.',
      takeaway: 'Traitez les points 🔴 avant de calibrer.',
    },
    en: {
      title: 'Data health score',
      what: 'We aggregate quality findings into a score out of 100: each blocking issue removes 20, each warning 6.',
      why: 'A simple score to decide at a glance whether the data is ready or needs fixing first.',
      details: 'A deliberately simple, explainable rule — no black box. Each finding’s detail shows the metric that triggered it.',
      takeaway: 'Handle the 🔴 items before calibrating.',
    },
  },
  splitRecommendation: {
    fr: {
      title: 'Recommandation de découpage',
      what: 'On détecte si vos données sont structurées par une métadonnée (ici l’instrument) et on découpe en conséquence (GroupKFold).',
      why: 'Si des répétitions ou un même instrument sont à la fois en apprentissage et en test, le test « triche » (fuite) et surestime la performance.',
      takeaway: 'Le découpage se fait par échantillon/instrument, jamais au hasard rangée par rangée.',
      methods: ['GroupKFold', 'sample_id grouping'],
    },
    en: {
      title: 'Split recommendation',
      what: 'We detect whether your data is structured by a metadata (here the instrument) and split accordingly (GroupKFold).',
      why: 'If replicates or one instrument appear in both training and test, the test "cheats" (leakage) and overstates performance.',
      takeaway: 'Splitting is by sample/instrument, never randomly row by row.',
      methods: ['GroupKFold', 'sample_id grouping'],
    },
  },
  hplcSelection: {
    fr: {
      title: 'Sélection des échantillons pour l’HPLC',
      what: 'Sous votre budget, on choisit des échantillons variés et représentatifs (sélection diversifiante), et on écarte les outliers forts vers une vérification.',
      why: 'La chimie humide coûte cher : on veut les échantillons qui apportent le plus d’information, pas les plus extrêmes. Un outlier n’est pas forcément un bon candidat.',
      details: 'Version actuelle : Kennard-Stone / SPXY (diversification géométrique). La méthode D-optimal (optimisation du volume d’information) est en cours d’ajout dans le moteur natif.',
      takeaway: 'On sélectionne des candidats informatifs, puis on vérifie leur atypie avant de les envoyer.',
      methods: ['Kennard-Stone', 'SPXY', '→ D-optimal (à venir)'],
    },
    en: {
      title: 'Choosing samples for HPLC',
      what: 'Within your budget, we pick varied, representative samples (diversifying selection) and hold back strong outliers for review.',
      why: 'Wet chemistry is expensive: we want the most informative samples, not the most extreme. An outlier isn’t necessarily a good candidate.',
      details: 'Current version: Kennard-Stone / SPXY (geometric diversification). D-optimal (information-volume optimization) is being added to the native engine.',
      takeaway: 'We pick informative candidates, then check their atypicality before sending them.',
      methods: ['Kennard-Stone', 'SPXY', '→ D-optimal (coming)'],
    },
  },
  budgetCurve: {
    fr: {
      title: 'Courbe budget ↔ couverture',
      what: 'On montre combien de « couverture » du domaine spectral chaque échantillon supplémentaire apporte.',
      why: 'Au-delà d’un certain nombre, chaque échantillon en plus apporte peu : la courbe aide à justifier le budget.',
      takeaway: 'Le trait pointillé marque le point de rendements décroissants.',
    },
    en: {
      title: 'Budget ↔ coverage curve',
      what: 'We show how much design-space "coverage" each extra sample adds.',
      why: 'Beyond a certain count, each extra sample adds little: the curve helps justify the budget.',
      takeaway: 'The dashed line marks the point of diminishing returns.',
    },
  },
  modelReport: {
    fr: {
      title: 'Bulletin du modèle',
      what: 'On construit le modèle et on le note : « assez bon pour du criblage ou de la quantification ? » selon des seuils (RPD/RPIQ) configurables par méthode.',
      why: 'Traduire des métriques statistiques en une décision d’usage concrète pour le labo.',
      details: 'RMSEP = erreur typique de prédiction. R² = part de variation expliquée. RPD/RPIQ = rapport de l’étalement des références à l’erreur : plus c’est haut, mieux c’est. Le détail montre la composition du pipeline et les résultats d’entraînement (observé vs prédit, résidus).',
      takeaway: 'La couleur du bulletin dit l’usage autorisé ; les chiffres disent pourquoi.',
      methods: ['RMSEP', 'R²', 'RPD', 'RPIQ', 'bias'],
    },
    en: {
      title: 'Model report card',
      what: 'We build the model and grade it: "good enough for screening or quantification?" against per-method thresholds (RPD/RPIQ).',
      why: 'Turning statistical metrics into a concrete usage decision for the lab.',
      details: 'RMSEP = typical prediction error. R² = share of variation explained. RPD/RPIQ = ratio of reference spread to error: higher is better. The detail shows the pipeline composition and training results (observed vs predicted, residuals).',
      takeaway: 'The card color states the authorized use; the numbers say why.',
      methods: ['RMSEP', 'R²', 'RPD', 'RPIQ', 'bias'],
    },
  },
  reliability: {
    fr: {
      title: 'Fiabilité d’une prédiction',
      what: 'Chaque prédiction reçoit un feu : 🟢 fiable, 🟠 prudence, 🔴 hors-domaine, 🔵 informatif à mesurer.',
      why: 'Un modèle NIRS n’est fiable que sur des échantillons ressemblant à ceux appris. La couleur relie un diagnostic (domaine, incertitude) à une action autorisée.',
      details: 'On combine la distance au domaine connu (T²/Q) et la largeur de l’intervalle. La « fiabilité » forte (intervalle conforme validé) arrive avec le conformal natif.',
      takeaway: 'Ne rendez jamais un 🔴 ; un 🔵 vaut la peine d’être mesuré.',
      methods: ['domaine d’applicabilité (T²/Q/kNN)', '→ conformal (à venir)'],
    },
    en: {
      title: 'Prediction reliability',
      what: 'Each prediction gets a light: 🟢 reliable, 🟠 caution, 🔴 out-of-domain, 🔵 informative to measure.',
      why: 'A NIRS model is only reliable on samples resembling those it learned. The color links a diagnostic (domain, uncertainty) to an authorized action.',
      details: 'We combine distance to the known domain (T²/Q) with interval width. Strong "reliability" (validated conformal interval) arrives with the native conformal engine.',
      takeaway: 'Never release a 🔴; a 🔵 is worth measuring.',
      methods: ['applicability domain (T²/Q/kNN)', '→ conformal (coming)'],
    },
  },
} satisfies Record<string, E>;
