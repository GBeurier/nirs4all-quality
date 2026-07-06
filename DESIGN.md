# quali-nirs4all — Design produit (studio miniature NIRS pour laboratoires d'analyse)

> Rapport de conception (produit d'abord, technique ensuite). Repo : **`nirs4all-quality`** · produit : **`quali-nirs4all`** *(provisoire)*.
> Source : [`docs/pipeline_lab.png`](docs/pipeline_lab.png) (schéma AR-NIRS 3 phases) + [`docs/pipeline_lab.docx`](docs/pipeline_lab.docx) (spécification du pipeline).
> Public cible : **laborantins néophytes en ML/stats**. Exigence : UX simple, pédagogique, « pré-mâchée ».
> Périmètre technique acté : **WASM thin-shell** (`nirs4all-core` + `dag-ml` runtime + `nirs4all-methods`/libn4m + `nirs4all-io`/`formats`), **sans Python**. Design **complet** (pas de MVP réduit). Revu par **Codex** (§9).
> Statut : design initial v1 — 2026-07-06.

---

## Context (pourquoi ce projet)

Un laboratoire d'analyse reçoit des échantillons physiques, les passe à la **NIRS** (spectro proche-infrarouge), et envoie une partie en **chimie humide / HPLC** pour obtenir des valeurs de référence (`y`). À partir de ces couples (spectre `X`, référence `y`), il calibre un modèle de prédiction, puis l'exploite en routine et le maintient dans le temps.

Aujourd'hui ce cycle repose sur l'expertise chimiométrique d'une poignée de personnes. Le document `pipeline_lab.docx` formalise un pipeline **AR-NIRS** complet (audit qualité → audit outlier → profil candidat → sélection d'enrichissement → vérification → calibration → évaluation → carte de fiabilité → maintenance) avec **50+ méthodes** (D-optimal PCA, Kennard-Stone, T²/Q-residual, GMM, conformal Mondrian, PDS/EPO...). C'est puissant mais **inaccessible à un laborantin**.

**But du produit** : une petite application — un « studio miniature », installable et/ou en ligne (WASM) — qui **cache toute cette complexité** et guide le laborantin à travers son vrai métier :

1. *Des échantillons arrivent* → lesquels re-passer à la NIRS, combien de répétitions ?
2. *Budget chimie humide limité* → **lesquels envoyer à l'HPLC** pour progresser le plus ?
3. *Les `y` reviennent* → le modèle est-il assez bon ? meilleur qu'avant ?
4. *En routine* → **chaque prédiction est-elle fiable** (vert/orange/rouge/bleu) ?
5. *Dans le temps* → le modèle dérive-t-il, que re-mesurer pour le garder robuste / le transférer ?

Le produit réutilise les briques existantes de l'écosystème (`nirs4all-core`, `nirs4all-ui`, `nirs4all-io`, `nirs4all-formats`, `nirs4all-datasets`, `dag-ml`, `nirs4all-methods`) et vise à terme une **version WASM 100 % client** (labos souvent hors-ligne / données sensibles). *La technique est traitée en fin de document ; le cœur est le produit.*

### Décisions d'orientation (arbitrages actés)
- **Nom** : repo **`nirs4all-quality`** (fixe) ; **produit = `quali-nirs4all`** *(provisoire, peut changer)*.
- **Périmètre technique** : **WASM thin-shell uniquement** — moteur = **`nirs4all-core` (aggregate) + `dag-ml` (runtime) + `nirs4all-methods`/libn4m (méthodes) + `nirs4all-io`/`nirs4all-formats` (WASM)**. **Pas** de dépendance à la lib Python `nirs4all`, **pas** de backend Python. Desktop éventuel = même app WASM enveloppée (Tauri).
- **Ampleur** : **design COMPLET, livré d'un coup** — pas de MVP réduit. Toutes les fonctions du schéma sont spécifiées ; le « phasage » (§5) n'est qu'un **ordre de construction**, pas une coupe de périmètre. *Réserve honnête* : deux kernels (D-optimal, conformal) sont réellement **neufs** même dans libn4m — voir §8.3.

---

## 0. La règle d'or à préserver (issue du document)

> **On ne sélectionne pas des outliers ; on sélectionne des échantillons *informatifs*, puis on vérifie leur profil d'atypie avant intégration.**

Le pipeline sépare explicitement deux questions qu'on confond souvent :
- **Diagnostic** : cet échantillon est-il atypique / hors-domaine ? (T², Q-residual, kNN, Mahalanobis…)
- **Sélection** : cet échantillon vaut-il la peine d'être payé en chimie humide ? (D-optimal PCA, Kennard-Stone…)

Un outlier spectral n'est PAS automatiquement un bon candidat. **L'application doit incarner cette règle sans jamais l'exposer** : elle ne propose jamais d'envoyer un outlier fort à l'HPLC sans un drapeau de vérification.

---

## 1. Principe de conception directeur

L'app est organisée **autour du métier du labo, pas autour du catalogue de méthodes**. Les 50+ méthodes du document sont des *rouages du moteur* ; le laborantin ne voit qu'une poignée de **décisions**.

Sept principes :

| # | Principe | Traduction concrète |
|---|----------|---------------------|
| P1 | **Workflow-first, pas method-first** | Navigation = étapes réelles du labo (recevoir → mesurer → décider → chimie → calibrer → prédire → maintenir), pas une liste d'algos. |
| P2 | **Opinionated defaults (pré-mâché)** | Le doc dit : D-optimal PCA par défaut, split par `sample_id` obligatoire, conformal pour l'incertitude. L'app choisit **automatiquement** ; les alternatives sont derrière un mode « Expert ». |
| P3 | **Feu tricolore partout** | 🟢🟠🔴🔵 comme langage visuel universel : chaque échantillon, prédiction, modèle a un statut coloré + un « pourquoi » en langage clair + une action. |
| P4 | **Pédagogie intégrée** | Jamais un chiffre brut sans interprétation métier (« RPD 2,4 = bon pour du criblage »). « Pourquoi je fais ça ? » sur chaque écran. Glossaire, cartes explicatives. |
| P5 | **Budget-aware** | Le vrai levier du labo = « combien d'échantillons puis-je payer en chimie humide ? ». L'app optimise sous ce budget et montre la **courbe budget↔performance**. |
| P6 | **Zéro fuite par construction** | Split par `sample_id`, test `T` gelé, `y` candidat interdit avant sélection — le laborantin *ne peut pas* faire ces erreurs. |
| P7 | **Local-first / traçable** | Tourne hors-ligne (WASM/desktop) ; chaque décision est versionnée (piste d'audit type ISO 17025). |

---

## 1bis. Réalités labo (fondation non négociable — issue de la revue)

*Le produit n'est crédible en labo que si l'ossature « paillasse » précède le ML.* Avant tout écran d'algorithme, `quali-nirs4all` doit poser un **modèle de données labo** et quelques garanties opérationnelles.

**Modèle de données labo (socle) :**
`Projet/Méthode` (cible, **matrice**, **unité**, base **humide/sèche**, instrument, méthode de référence, **version SOP**) → `Lot` (réception / instrument / campagne-site-saison / batch HPLC) → `Échantillon` (`sample_id` stable, code-barres) → `Répétition spectrale` → `Mesure de référence` (valeur HPLC + statut analytique : validé / répétabilité / LOQ / dilution / reprise / sous-traitée) → `Statut échantillon` (reçu / mesuré NIRS / à re-mesurer / envoyé HPLC / intégré / écarté) → `Piste d'audit` (qui / quand / quoi / justification, **non modifiable**).

**Garanties opérationnelles (ISO 17025-ready) :**
- **Identité & traçabilité d'abord** : `sample_id` + code-barres, chaîne de custody (aliquots, duplicatas, re-mesures, opérateur, instrument, lot de consommables).
- **Rôles simples** : *opérateur* (mesure, prédit) vs *responsable méthode/qualité* (valide, déploie, override) — les overrides sont **tracés et justifiés**.
- **Statut modèle** : « en qualification » vs « en production » ; audit trail non modifiable ; validation de méthode.
- **La référence HPLC n'est pas une vérité instantanée** : le retour `y` porte un statut analytique ; l'app gère reprise, incohérence vs historique, changement de méthode HPLC.
- **Coût réel ≠ `n`** : le budget dépend du type d'analyse, sous-traitance, délais, batch minimum, capacité instrument — le curseur budget expose ces facteurs, pas juste un nombre.
- **LIMS-first** : import/export **CSV LIMS** traçable dès le départ (les fichiers/dossiers restent le mode de démarrage, mais le vrai labo vit dans un LIMS).
- **Événements instrument** : capturer lampe/nettoyage/température/humidité/coupelle/granulométrie/opérateur comme métadonnées de dérive (pas seulement les metadata analytiques).

Ces éléments **priment sur les fonctions ML** : ils sont la condition de crédibilité et de conformité, et ils conditionnent la sémantique de décision (§4bis).

## 2. Modèle mental présenté à l'utilisateur

On reformule les 3 phases + 5 questions du document en un récit de labo simple.

**Un projet = une méthode analytique** (ex. « Protéines dans la farine de manioc »). Dans un projet, l'app déroule une **boucle** en 3 temps, calqués sur les 3 phases du schéma :

```
 PRÉPARER  ─────────────►  CALIBRER  ─────────────►  UTILISER & MAINTENIR
 (Avant calibration)       (Calibration)             (Exploitation)
 setup · santé des         construire le modèle,     prédire avec fiabilité,
 données · quoi envoyer     est-il assez bon ?        décider, surveiller la
 à l'HPLC                                             dérive, planifier l'update
        ▲                                                        │
        └──────────────── boucle update (le modèle réapprend) ◄──┘
```

C'est exactement la « boucle update » du schéma (flèche verte qui remonte). Le laborantin comprend : *je prépare mes données → je choisis quoi mesurer → je calibre → j'utilise → je re-boucle quand ça dérive*.

---

## 3. Architecture de l'information (écran par écran)

Application **project-centric**, avec un **rail de gauche = suivi de progression** (stepper des étapes du workflow) et un canevas central. Assistant (wizard) au premier passage, navigation libre ensuite. Deux modes partout : **Guidé** (défaut, néophyte) et **Expert** (débloque choix de méthodes + seuils) — *progressive disclosure*.

### Écran 0 — Tableau de bord / Projets
- Une carte par projet (méthode analytique). Chaque carte : **feu tricolore du modèle**, nb d'échantillons en calibration, dernier RMSEP/RPD, **badge « action requise »** (ex. « 12 échantillons en attente de résultats HPLC », « dérive détectée »).
- Gros bouton « Nouveau projet » → wizard.

### Écran 1 — Assistant de démarrage (setup ; bloc A + design C/P/T)
Wizard en 5 étapes, langage courant :
1. **Que mesurez-vous ?** cible + unité + type de matrice (farine/sol/feuille…) + instrument.
2. **Chargez vos spectres.** Glisser un dossier/fichiers ; formats auto-détectés (`nirs4all-formats`). L'app affiche : nb spectres, nb échantillons, nb répétitions détectées, gamme de longueurs d'onde, **aperçu spectral live**.
3. **Avez-vous déjà des valeurs de référence ?** (HPLC antérieure) → import CSV, **jointure auto par `sample_id`** (`nirs4all-io`). Sinon « Départ à froid ».
4. **Métadonnées** : site, année, instrument, batch (optionnel mais encouragé — l'app explique *pourquoi* : « pour découper équitablement et détecter la dérive »).
5. **Budget chimie humide** : « Combien d'échantillons pouvez-vous envoyer au labo ? » (curseur).
- **Sortie** : projet prêt ; `C/P/T` désignés automatiquement. `T` (test gelé) expliqué simplement : *« un jeu verrouillé qu'on ne touche jamais, pour pouvoir faire confiance au modèle honnêtement »*.

### Écran 2 — Santé des données (bloc C Dataset Quality Passport + D Metadata audit + E triage)
Un écran « Santé des données » : un **score global** + une **check-list de constats**, chaque ligne = feu tricolore + langage clair + action suggérée + échantillons concernés :
- « 3 spectres semblent saturés → re-mesurer »
- « Échantillon #42 : répétitions incohérentes → re-passer ou retirer une répétition »
- « Bandes 1900–1950 nm bruitées (eau) → exclues automatiquement »
- « 2 échantillons : la référence `y` ne colle pas au spectre → à vérifier »
- **Audit de structure metadata** rendu simple : *« Vos données sont groupées par instrument → on découpera par instrument pour un test honnête »* (recommandation de split auto, en langage clair).
- **Actions** : marquer *re-mesurer / exclure / accepter*. Génère une **liste de travail « à re-mesurer »** (imprimable/exportable).
- Pédagogie : chaque constat dépliable « Pourquoi c'est important ? ».

### Écran 3 — Choisir quoi envoyer à l'HPLC (bloc F+G+H+I) — ⭐ fonction phare
- Le laborantin ajuste le **budget `n`**.
- En coulisse : **D-optimal PCA** par défaut + **audit outlier** en garde-fou → produit une **liste priorisée de candidats** : `sample_id`, une **étiquette « pourquoi choisi »** (« étend la gamme », « comble un trou », « type rare »), et un **drapeau sécurité** (🟢 sûr à envoyer ; 🟠 à vérifier, possible artefact — les outliers forts sont déjà écartés).
- **Carte PCA (score plot 2D)** : échantillons de calibration (gris) + candidats retenus (surlignés) → le laborantin **voit** pourquoi : « ils remplissent les coins vides ». *C'est le cœur pédagogique* — rend la sélection intuitive.
- **Courbe budget↔performance** : « 10 échantillons → RMSEP attendu ~X ; 20 → ~Y ; rendements décroissants après ~15 ». Aide à justifier le budget à la hiérarchie.
- **Sortie** : une **liste de travail HPLC** (export PDF/CSV avec `sample_id` + codes-barres), + le profil de chaque candidat documenté (traçabilité).
- **Mode Expert** : changer de méthode (KS, DUPLEX, D-optimal PLS si un modèle existe), comparer les différences.

### Écran 4 — Saisir les résultats & calibrer (bloc J calibration + K évaluation)
- Retour HPLC : import des `y` (CSV, jointure auto). L'app valide (« 2 valeurs semblent aberrantes vs le spectre — re-vérifiez le résultat labo »).
- Un clic **« Construire le modèle »** → pipeline pré-mâché : grille de prétraitement + CV imbriquée + split recommandé, sélection du meilleur (en coulisse).
- **Bulletin du modèle** : gros feu « Assez bon pour [criblage / quantification] ? » selon seuils RPD/RPIQ expliqués ; RMSEP, R², biais avec interprétation ; résidus par metadata = *« Est-il équitable entre sites/années ? »*.
- **Comparaison de versions** : « Nouveau vs précédent : RMSEP −12 %, aucun site dégradé → Déployer recommandé. » Décision claire Déployer / Garder l'ancien.
- Le test `T` gelé fournit le chiffre final honnête (expliqué).

### Écran 5 — Prédire & décider (bloc L carte de fiabilité + M décision) — usage routine
- Glisser de nouveaux spectres → prédictions instantanées.
- Chaque prédiction = une **carte** : valeur prédite ± intervalle (conformal) + gros **feu tricolore** :
  - 🟢 **Vert** : fiable, utilisez-la.
  - 🟠 **Orange** : en bordure / incertain — prudence ou double-contrôle.
  - 🔴 **Rouge** : hors-domaine / non fiable — chimie humide / re-mesure.
  - 🔵 **Bleu** : échantillon **intéressant** — le mesurer améliorerait le modèle (alimente la maintenance).
- « Pourquoi » en langage clair par couleur (ex. « ce spectre ne ressemble à rien de connu du modèle »).
- **Vue lot** : table de tous les nouveaux échantillons avec leurs feux ; filtres « rouges à re-mesurer » / « bleus à mesurer ».
- Export résultats (avec drapeaux de fiabilité) vers le LIMS / rapport du labo.

### Écran 6 — Garder le modèle en forme (bloc N Maintenance planner)
- Dashboard de suivi : volume de prédictions dans le temps, part de 🟢🟠🔴, indicateurs de dérive (« plus de rouges récemment — nouveau type d'échantillon ? »).
- **Proposition d'update périodique** : « On recommande de mesurer ces 8 échantillons ce trimestre pour rester robuste » (batch de contrôle + candidats bleus) → même export « liste de travail » que l'écran 3.
- **Assistant transfert d'instrument** (nouvel appareil) : « Mesurez ces standards sur les deux appareils » → PDS/EPO appliqué automatiquement.
- Historique des versions / rollback, avec la piste d'audit (quoi ajouté, perf avant/après).

---

## 4. Éléments UX transverses
- **Système tricolore universel** 🟢🟠🔴🔵 — même sens partout (échantillon, prédiction, modèle).
- **« Expliquer » partout** — glossaire inline, cartes au survol, panneau latéral « Apprendre » par écran.
- **Listes de travail** = le pont physique vers la paillasse (impression / scan `sample_id`, codes-barres/QR).
- **Deux modes** : Guidé (défaut) / Expert (débloque méthodes + seuils), mêmes données, divulgation progressive.
- **Traçabilité/versioning** toujours actifs (labos accrédités / ISO 17025) — argument de vente.
- **Local-first** — hors-ligne, données jamais envoyées à un serveur.

---

## 4bis. Contrat de décision des couleurs (le vrai cœur du produit)

La revue est claire : *le blocage n'est pas l'UI, c'est la sémantique de décision.* Le feu tricolore est **dangereux** s'il n'est pas relié à des actions, des seuils validés et des responsabilités. Chaque couleur est donc un **contrat** explicite, jamais un simple pictogramme. Une prédiction/candidat affiche **toujours** : statut + **raison principale** + **action autorisée** + **niveau de confiance** + lien « voir le détail ».

| Couleur | Signification | Action **autorisée** | Seuils (par méthode validée, configurables) | Trace enregistrée | Qui peut outrepasser |
|---|---|---|---|---|---|
| 🟢 **Fiable** | dans le domaine X, intervalle raisonnable, pas d'extrapolation | résultat utilisable en routine | AD < seuil méthode ; largeur d'intervalle < max méthode | résultat + version modèle | — |
| 🟠 **Prudence** | bordure de domaine / incertitude élevée | utilisable **avec contrôle** ou 2ᵉ lecture | zone intermédiaire | résultat + raison + qui a validé | responsable méthode |
| 🔴 **Hors domaine** | X hors-domaine, Q élevé, intervalle très large | **ne pas rendre** → chimie humide / re-mesure | AD > seuil hors-domaine / gate négatif | motif + orientation HPLC | responsable méthode (justifié) |
| 🔵 **Informatif pour amélioration** *(≠ « bon »)* | échantillon dont la mesure enrichirait le modèle | proposer en file d'enrichissement | faible densité locale / gamme peu couverte | ajout à la file update | — |

**Règles UX dérivées de la revue :**
- **Séparer les catégories confondables** dans l'interface : *outlier spectral* ≠ *erreur de mesure* ≠ *échantillon rare* ≠ *hors-domaine* ≠ *candidat HPLC* ≠ *prédiction incertaine*. Chacune a sa formulation et son action.
- **Vocabulaire non pseudo-certain** : « à vérifier », « hors du domaine du modèle actuel », « référence incohérente avec l'historique » — jamais « mauvais » / « erreur ».
- **« Assez bon pour criblage / quantification »** = **configurable par méthode validée** (pas des seuils RPD/RPIQ codés en dur).
- La **carte PCA 2D est une explication**, pas une preuve (l'afficher comme aide visuelle, avec avertissement que 2D écrase l'information).
- **Mode Expert = risque de casser les garanties** : les overrides sont **tracés, justifiés, réservés au rôle méthode/qualité**.

## 5. Périmètre complet & ordre de construction (pas de MVP réduit)

*On livre le design complet, tout est spécifié — aucune fonction du schéma n'est coupée. Ce qui suit n'est donc **pas** un découpage de périmètre mais un **ordre de construction** en couches, pour que chaque couche soit utilisable et testable avant la suivante. Les ensembles §13.2/13.3/13.4 du document servent seulement à ordonner l'effort.*

| Couche | Contenu (tout est dans le périmètre final) | Nature de l'effort |
|---|---|---|
| **C0 — Socle labo** | modèle de données (§1bis) · statuts échantillon · audit trail non modifiable · rôles · CSV LIMS · codes-barres · **contrat de décision** (§4bis) | UI + schéma de données (neuf, non-ML) |
| **C1 — Ingestion & santé** | import spectres (≈58 formats) + jointure `reference.csv` · Quality Passport (NaN/saturation/variance, T²/Q/Mahalanobis/leverage) · audit structure metadata · triage · listes de travail « à re-mesurer » | **exposition WASM** de libn4m `outlier_detection.h` + `nirs4all-io`/`formats` (déjà WASM) |
| **C2 — Calibration** | split sans fuite `sample_id`/GroupKFold/LOGO · grille preproc + CV · zoo PLS + AOM · test `T` gelé · bulletin modèle (RMSEC/RMSECV/RMSEP/R²/RPD/**RPIQ**/biais/slope/résidus par metadata) | libn4m (existe) + **RPIQ/slope/résidus-metadata** à ajouter à `metrics.h` |
| **C3 — Sélection enrichissement** | **D-optimal PCA (défaut)** + Kennard-Stone/SPXY/DUPLEX · vérification avant intégration (croise audit outlier) · courbe budget↔couverture (descriptive) puis ↔RMSEP (prédictive) · profils candidats | KS/SPXY (existe) ; **D-optimal = kernel natif neuf** (`model_selection.h`) |
| **C4 — Fiabilité & décision** | carte de fiabilité par-prédiction · domaine X (T²/Q/kNN/Mahalanobis) · **incertitude Y = conformal + Mondrian** (couverture validée) · extrapolation Y · décision 🟢🟠🔴🔵 sous contrat | AD (exposition libn4m) ; **conformal = neuf natif** (`dag-ml` + `metrics`) |
| **C5 — Maintenance & transfert** | maintenance planner (contrôle/amélioration/transfert) · densité/entropie **GMM** + gate OOD/SSI · **transfert PDS/DS/DOP** (EPO/OSC existent) · versioning modèle · rollback | GMM + PDS/DS = neufs natifs ; EPO/OSC existent |
| **C-Expert** | GP-EQI · Pareto · GMM-stratified KS · GMM need-weighted maximin · KS-L1 · cosine · whitened PCA · UMAP/PERMANOVA/ANOSIM (audit avancé, rôle responsable) | mode Expert tracé (§4bis) |

> **Tout est là** — mais soyons honnêtes sur *ce qui existe vs ce qui est neuf* : l'immense majorité est de l'**exposition WASM** (le C++ libn4m existe) + de l'**UI**. Les seuls **kernels réellement neufs** sont **D-optimal** (C3), **conformal/Mondrian** (C4), **GMM density/OOD** et **PDS/DS** (C5) — voir §8.3. C'est peu, mais non trivial : à écrire natif (pas de shim TS), testé contre oracle, puis exposé WASM.

---

## 6. Pros / Cons / Rationale

**Workflow-first vs le pipeline-builder du Studio complet**
- *Pour* : le Studio existant s'adresse à des *concepteurs de pipelines* ; ici l'utilisateur est un *opérateur de labo*. Un builder à nœuds le noierait.
- *Contre* : moins flexible pour un power-user. *Mitigation* : mode Expert.

**Opinionated defaults (pré-mâché)**
- *Pour* : indispensable pour un néophyte ; évite les erreurs méthodo (fuite, sur-optimisme).
- *Contre* : « boîte noire » perçue. *Mitigation* : pédagogie « pourquoi ce choix » + Expert override.

**WASM / local-first (chemin unique acté)**
- *Pour* : données sensibles, labos hors-ligne, zéro install serveur, portable, « effet ouaw » en ligne ; un seul code navigateur + desktop (Tauri).
- *Contre* : compute lourd (modèles profonds type CNN/transformers) hors de portée du navigateur. *Mitigation* : PLS/AOM via libn4m couvrent le besoin NIRS ; le desktop Tauri enveloppe la **même** WASM (pas de compute supplémentaire) ; les modèles profonds, s'ils deviennent nécessaires, sont un chantier natif séparé — hors périmètre.

**Réutilisation des briques écosystème**
- *Pour* : vitesse de dev, cohérence, une seule source de vérité numérique (`dag-ml`/`nirs4all-methods`).
- *Contre* : couplage ; l'UI simplifiée peut réclamer des composants que le Studio complet n'a pas encore. *Mitigation* : composants dans `nirs4all-ui` partagés.

---

## 7. Noms de projet

*(Convention écosystème : repo `nirs4all-<mot>`, marque produit distincte possible — comme repo `nirs4all-studio` → produit « nirs4all Studio ». Contraintes de collision : `nirs4all-lab/` = repo recherche, `nirs4all-benchmarks/`, `ecosystem-cockpit` = design admin existant.)*

### Décision
- **Repo** : **`nirs4all-quality`** (fixe, institutionnel).
- **Produit** : démarré sous **`quali-nirs4all`** *(provisoire, révisable)*. Aucun nom ne satisfaisait pleinement ; **NIRS-QA** (choix de la revue Codex, vocabulaire des labos accrédités) et **NIRS Triage** (crie la fonction phare : décider par échantillon) restent des candidats de repli si le positionnement doit être ré-affirmé.

### Alternatives évaluées (rationale)

**A. Autour de « qualité / assurance »**

| Repo | Marque | Rationale |
|------|--------|-----------|
| `nirs4all-quality` | **quali-nirs4all** | *(retenu)* Passport qualité + fiabilité ; langage des labos accrédités. Réserve : « quality » peut sous-vendre la sélection HPLC + la décision tricolore → sous-titre explicite recommandé. |
| `nirs4all-qa` | **NIRS-QA** | « QA/QC » = le vocabulaire **exact** des labos ; couvre toute la boucle d'assurance. |
| `nirs4all-assay` | **Assay** | un *assay* est précisément ce que fait un labo ; professionnel, englobe mesure + fiabilité. |
| `nirs4all-passport` | **Passport** | tiré du « Quality Passport » ; imagé ; ⚠ un peu étroit (audit only). |

**B. Autour de la *décision* / du *tri***

| Repo | Marque | Rationale |
|------|--------|-----------|
| `nirs4all-triage` | **Triage** | colle au schéma (« Sample triage ») et aux feux 🟢🟠🔴🔵 ; dit d'emblée la valeur. |
| `nirs4all-pilot` | **LabPilot** | angle pédagogie/guidage + « pilot study » (calibration). |
| `nirs4all-advisor` | **Sample Advisor** | décrit la fonction phare : *quoi envoyer à l'HPLC*. |

**C. Métier / francophone**

| Repo | Marque | Rationale |
|------|--------|-----------|
| `nirs4all-bench` | **Paillasse** | *bench* = la paillasse ; ⚠ confusion possible avec `benchmarks`. |
| `nirs4all-atelier` | **Atelier** | *studio* en FR, humble et juste pour un public CIRAD. |
| `nirs4all-loop` | **Loop** | la boucle enrichissement/maintenance AR-NIRS ; un peu abstrait. |

> *Sous-titre marketing recommandé si on garde quali-nirs4all* : « quali-nirs4all — qualité des données, **sélection HPLC & fiabilité** pour votre labo NIRS ».

---

## 8. Réutilisation & faisabilité technique

*(La technique « vient plus tard » ; cette section n'est qu'un **filet de faisabilité** pour montrer que le produit est atteignable en réutilisant l'existant, et pour cadrer le vrai travail neuf.)*

### 8.1 La base à réutiliser : `nirs4all-web / studio-lite`
Le point de départ existe déjà et est mûr : **`nirs4all-web/studio-lite/`** (live sur **web.nirs4all.org**) est **exactement** le « studio miniature WASM » demandé — une coquille mince React 18 + Vite + shadcn au-dessus de la chaîne `formats → io → dag-ml-data → dag-ml → libn4m`, **sans backend, 100 % navigateur**, avec upload → explore (+PCA) → configuration dataset → run CV/refit → résultats → prédiction → export `.n4a`. Doctrine « thin shell » stricte : *aucune logique numérique en TypeScript*, tout vit dans les libs WASM.

> **Note** : studio-lite **n'utilise pas ONNX** ; le moteur numérique est **libn4m** (C++17 → WASM via Emscripten). WebGL sert uniquement au nuage PCA 3D.

**Décision actée : chemin WASM thin-shell uniquement** (pas de backend Python, pas de dépendance à la lib Python `nirs4all`). Une seule base de code, deux cibles : navigateur = déployer comme aujourd'hui (GitHub Pages, façon `web.nirs4all.org`) ; desktop installable = envelopper la **même app WASM** dans **Tauri** → hors-ligne, léger, un seul code. Le moteur est **`nirs4all-core` (aggregate) + `dag-ml` (runtime WASM) + `nirs4all-methods`/libn4m (méthodes) + `nirs4all-io`/`nirs4all-formats` (WASM)**. *Conséquence importante* : tout ce qui était mappé sur la lib **Python** `nirs4all` (filtres AD, métriques, transferts…) doit venir de son équivalent **libn4m/dag-ml exposé en WASM** — heureusement le C++ existe déjà pour la plupart (voir 8.2/8.3) ; le travail est l'**exposition au catalogue WASM**, pas la ré-implémentation.

### 8.2 Ce qui tourne DÉJÀ client-side (≈ 80-90 % du workflow)
| Fonction de `quali-nirs4all` | État WASM | Brique réutilisée |
|---|---|---|
| Charger spectres (≈58 formats vendeurs, HDF5/MATLAB/Parquet inclus) | 🟢 OK | `nirs4all-formats` WASM (sniff + decode en mémoire) |
| **Jointure « dossier spectres + `reference.csv` (valeurs HPLC) »** | 🟢 Moteur OK | `nirs4all-io` core Rust→WASM : layout *vendor-corpus*, join `m:1` sur `filename_stem` — **pattern de 1re classe**, prouvé sur `io.nirs4all.org` |
| Prétraitement SNV/MSC/SG/dérivées/baseline | 🟢 OK | `libn4m` (~60 opérateurs au catalogue `studio-lite/src/catalog/nodes.ts`) |
| PCA (visuel) | 🟢 OK | JS client (`studio-lite/src/components/dataset/pca.ts`) |
| Sélection Kennard-Stone / SPXY / KMeans / KBinsStratified / DataTwinning | 🟢 OK | `libn4m` `model_selection.h` (`kennard_stone`, `spxy`) |
| Split sans fuite (`sample_id`, GroupKFold, LOGO) | 🟡 partiel | splitters exécutés par `dag-ml` en WASM ; mais le mapping *répétition→groupe* (`compute_effective_groups`, aujourd'hui en Python) doit être **porté dans `dag-ml`/libn4m** pour la garantie anti-fuite côté navigateur |
| Calibration PLS + CV honnête | 🟢 OK | `libn4m` PLS + `dag-ml` exécute FIT_CV en WASM (leakage-safe) |
| Modèles PLS (zoo riche) + famille **AOM** (AOMPLS/POPPLS/AOMRidge) | 🟢 OK | `libn4m` / `nirs4all.operators.models` |
| Métriques RMSEC/RMSECV/RMSEP/R²/RPD/biais | 🟢 OK | `libn4m metrics.h` (natif) |
| Prédiction ponctuelle + bundle `.n4a` | 🟢 OK | studio-lite predict + round-trip `.n4a` |
| Filtres qualité (NaN/saturation/variance), outliers T²/Q/Mahalanobis/leverage | 🟡 Existe mais non câblé WASM | `libn4m` `outlier_detection.h` (C++, pas encore au catalogue navigateur) |

### 8.3 Le vrai travail neuf (rien à réutiliser — les 2 fonctions phares en font partie)
Aligné sur le **North Star** (nouvelles capacités algorithmiques = **natives** dans `nirs4all-methods`/`dag-ml`, jamais un shim Python/TS) — bénéfice : chaque brique ci-dessous, écrite une fois en C++/Rust, arrive **gratuitement** en navigateur (WASM) **et** en Python **et** en R/MATLAB.

| Manque | Écran | Où le construire (natif) | Point d'ancrage existant |
|---|---|---|---|
| ⭐ **Sélection D-optimal PCA/PLS** (enrichissement) | 3 | `libn4m` `model_selection.h` | à côté de `kennard_stone`/`spxy` déjà là ; KS/SPXY servent de **repli fonctionnel** |
| ⭐ **Carte de fiabilité / conformal (intervalles + couverture Mondrian)** | 5 | `dag-ml` (coordination) + `libn4m metrics` | **le plus gros trou** : aucune prédiction à intervalle nulle part |
| Densité/entropie **GMM**, gate **OOD/SSI** | 3, 5 | `libn4m` `outlier_detection.h` | headers d'outliers déjà présents |
| **Audit structure metadata** (UMAP/MDS/PERMANOVA, sonde de fuite site/année) | 2 | `dag-ml` analyse | projections PCA seules aujourd'hui |
| Transfert **PDS/DS/DOP** | 6 | `libn4m` `domain_adaptation.h` | **EPO/OSC/DiPLS déjà là** à côté |
| **RPIQ** + slope/intercept + résidus par metadata | 4 | `libn4m metrics.h` | petit ajout |
| **Carte de fiabilité par-prédiction** + **workflow d'enrichissement** empaqueté | 5, 3 | orchestration `dag-ml` | filtres AD fit-time à convertir en score par-prédiction |

**Câblage seul (le C++ existe, la binding navigateur retarde)** : exposer `outlier_detection` au catalogue WASM ; prétraitements *shape-changing* (crop/resample/wavelet) + stateful (EMSC/EPO/OSC) via nouveaux helpers `_n4m_wasm_*` (aucun changement d'ABI) ; ~7 modèles non-coefficient au predict WASM.

**UI neuve (le gros du produit, côté TS)** : le workflow guidé (wizard/stepper), les **cartes tricolores** de fiabilité, la **courbe budget↔performance**, la **carte PCA d'enrichissement** (candidats surlignés), l'export **liste de travail** (HPLC / re-mesure, codes-barres), le **dashboard maintenance**. Composants réutilisables identifiés dans `nirs4all-studio` + `nirs4all-ui` (voir 8.4).

### 8.4 Briques UI réutilisables (depuis `nirs4all-studio` + `nirs4all-ui`)
- **Coquille & thème** : partir du thème HSL « scientifique » teal de studio-lite/studio (`index.css`, tokens `--chart-*`, `--success/--warning/--destructive`, modes de densité) — cohérence visuelle gratuite. Gabarit de sous-app : `nirs4all-studio/src/pages/Lab.tsx`.
- **Stepper guidé / wizard** : `experiments/NewExperimentStepProgress.tsx` (cercles numérotés) + machine à états `datasets/DatasetWizard/WizardContext.tsx`.
- **Feu tricolore** (cœur du produit) : `nirs4all-ui` `runtime/statusDisplay.ts` + `RuntimeResultStatusBadge` ; `datasets/DatasetStatusBadge.tsx` (vert/ambre/rouge/gris prêt à l'emploi) ; `ui/badge.tsx`.
- **Spectres & PCA** : `charts/BaseSpectraChart.tsx`, `datasets/charts/SpectraChart.tsx` (simple), `playground/visualizations/DimensionReductionChart.tsx` (PCA/UMAP 2D → base de la carte d'enrichissement).
- **Upload** : `datasets/DropZoneOverlay.tsx` (détecte dossier vs fichiers, liste les formats).
- **Cartes résultat / KPI** : `predict/PredictResultsCards.tsx`, `nirs4all-ui` `MetricValueBadge` (coloration meilleur/pire).
- **Pédagogie « expliquer »** : `pipeline-editor/HelpSystem.tsx` (`HelpTooltip`, `WhatsThisButton`, `InfoCallout`, `HelpModeProvider`) + `helpContent.ts` — exactement le mécanisme « pré-mâché ».
- **Presets guidés (cacher le ML)** : le **catalogue studio-lite** (`studio-lite/src/catalog/nodes.ts`, CI-gaté sur les symboles ABI libn4m) est la source de vérité des méthodes exposées ; on y adosse des **recettes pré-mâchées** (preprocessing+PLS par matrice) sans exposer les nœuds. *(Les composants React de `nirs4all-studio` réutilisés ici sont du front pur — aucun backend Python requis.)*
- **Table & états** : `ui/table.tsx`, `ui/state-display.tsx` (empty/error/loading).

### 8.5 Chemin de construction recommandé (ordre — socle labo d'abord)
1. **Modèle de données labo + sémantique de décision** (§1bis, §4bis) : projet/méthode/matrice/unité/lots/`sample_id`/répétitions/référence/**statut**/**audit trail**/rôles, et le **contrat des couleurs**. *C'est ici le vrai blocage, pas l'UI.*
2. **Forker/dériver `studio-lite`** comme squelette `nirs4all-quality` (thin shell, moteur WASM déjà branché) — navigateur d'abord, desktop via **Tauri** ensuite. Habiller avec le workflow guidé + tricolore + pédagogie (réutiliser §8.4) ; node-editor masqué derrière le mode Expert.
3. **Ingestion + jointure + qualité + exports listes de travail** (CSV LIMS + codes-barres).
4. **Calibration PLS + split sans fuite + bulletin modèle** compréhensible (test `T` gelé).
5. **Sélection HPLC** = **Kennard-Stone / SPXY** d'abord (libellée « sélection diversifiante ») + **garde-fou outliers** (T²/Q câblés au navigateur) ; **D-optimal** ajouté en couche C3.
6. **Prédiction batch + fiabilité** (domaine d'applicabilité par-prédiction d'abord ; **conformal** ajouté en C4 ; statuts 🟢🟠🔴🔵 sous contrat).
7. **Natif prioritaire** dans `libn4m`/`dag-ml` : **D-optimal PCA** (à côté de KS), puis **conformal + Mondrian** (le trou majeur ; « fiabilité » forte seulement après **validation de couverture**), puis GMM/OOD, PDS/DS, audit metadata, RPIQ. *Pas de shim TS, pas de faux intervalle* ; chaque brique testée contre oracle Python/C++ et disponible WASM.
8. **Maintenance planner** en dernier.

> Chaque ajout natif = une entrée catalogue CI-gatée → apparaît **gratuitement** en navigateur, Python, R/MATLAB.

---

## 9. Revue Codex (et intégration)

Proposition passée en **revue Codex** (schéma source + doc en entrée). **Verdict** : direction juste sur le workflow AR-NIRS, mais la v1 du design **surestimait la maturité « produit » du mini-studio et sous-estimait le quotidien d'un labo accrédité**. Deux risques majeurs pointés — et acceptés :

1. **On construit une belle UX ML avant de sécuriser l'identité échantillon / LIMS / traçabilité.** → *Corrigé* : ajout de la **couche « Réalités labo »** (§1bis) comme fondation, et du **modèle de données labo** en tête du chemin de construction.
2. **On promet D-optimal + conformal alors que ce sont précisément les briques natives manquantes ; et le feu tricolore devient dangereux s'il n'est pas relié à des actions/seuils/responsabilités validés.** → *Corrigé* : **contrat de décision** des couleurs (§4bis), KS/SPXY re-labellisé « sélection diversifiante » (pas l'optimiseur AR-NIRS), pas de promesse de « fiabilité » avant validation de couverture conformale.

**Points de la revue intégrés :**
- *Le vrai blocage n'est pas l'UI, c'est la sémantique de décision* → §4bis.
- *Réalités labo manquées* (LIMS-first, codes-barres/chaîne de custody, gestion des **lots**, la référence HPLC n'est pas une vérité instantanée — répétabilité/LOQ/dilution/reprise/sous-traitance, unités & base humide/sèche & version SOP, ISO 17025 = audit trail non modifiable + rôles + statut « en qualification » vs « en production », multi-utilisateurs, coût réel ≠ juste `n`, événements physiques instrument lampe/nettoyage/granulométrie) → §1bis.
- *Risques UX* : le tricolore seul ne suffit pas (toujours afficher statut + raison + action + confiance + détail) ; **le 🔵 est ambigu** → renommé « **informatif pour amélioration** » (≠ « bon/fiable ») ; séparer explicitement dans l'UI les catégories confondables ; la carte PCA 2D est une **explication**, pas une preuve ; « assez bon pour criblage/quantification » **configurable par méthode validée** ; vocabulaire non pseudo-certain.
- *Nommage* : Codex rejoint la réserve — repo `nirs4all-quality` OK, mais **produit** devrait vendre « QA / triage / fiabilité » : son choix tranché = **NIRS-QA** (ou **NIRS Triage**). → reflété en §7.

**Nuance vs Codex** : Codex propose de couper *toute* la courbe budget↔performance. On la **garde en version descriptive** (couverture PCA gagnée à budget `n`, sans promesse prédictive de RMSEP) — peu coûteux et très pédagogique ; seule la version *prédictive* (RMSEP attendu) est repoussée après validation.

---

## Vérification (comment valider le produit une fois construit)

Parcours de bout en bout, sur un **dataset de référence connu** (`nirs4all-datasets`, DOI-pinné) pour avoir une vérité terrain :
1. **Charger** : dossier de spectres vendeur + `reference.csv` → jointure `m:1` → `SpectroDataset` (vérifier nb échantillons/répétitions/gamme λ vs attendu).
2. **Santé** : injecter des spectres saturés/NaN artificiels → vérifier qu'ils sont bien flaggés « re-mesurer » ; vérifier la recommandation de split sur un dataset multi-instruments.
3. **Sélection HPLC** : masquer les `y` d'un pool `P`, lancer la sélection sous budget `n` → comparer la liste **D-optimal PCA** (natif) et **Kennard-Stone** au moteur de référence (mêmes indices ± tolérance) ; vérifier que les **outliers forts sont drapeaux orange** et non auto-sélectionnés (règle d'or).
4. **Calibration** : réintégrer les `y`, construire le modèle → **RMSEP/R²/RPD** doivent égaler (à tolérance) une exécution de référence sur le **même split** ; test `T` gelé jamais touché.
5. **Prédiction & fiabilité** : prédire sur des spectres in-domain (→ 🟢), hors-domaine forgés (→ 🔴), en bordure (→ 🟠) → vérifier feux + intervalle conformal + **couverture empirique** ≈ niveau cible sur un jeu de calibration conformal.
6. **Maintenance** : simuler une dérive (nouveau site) → vérifier que le planner propose un batch de contrôle non vide.
7. **Portabilité / parité** : l'app tourne **100 % navigateur (WASM)** ; sa correction se valide contre un **oracle Python de développement** (non embarqué) — l'oracle de parité déjà en place dans `nirs4all-core` (KS / SNV / SG / PLS) doit être **étendu aux nouveaux kernels** (D-optimal, conformal, GMM, PDS) : chaque kernel natif passe l'oracle avant d'être exposé au catalogue WASM. C'est le garde-fou « aucune logique en TS ».
