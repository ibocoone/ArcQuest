import { ArrowLeft } from 'lucide-react'
import { Card } from '../ui'

const TERMS: [string, string][] = [
  ['1. Le service', "ArcQuest met en relation des créateurs, qui publient des tâches et des concours financés en USDC, et des participants qui les réalisent. Le service fonctionne actuellement sur Arc Testnet : les montants n'ont aucune valeur réelle."],
  ['2. Compte', "Vous pouvez créer un compte avec une adresse e-mail et un mot de passe, ou avec un portefeuille. Vous êtes responsable de la confidentialité de vos identifiants et de votre portefeuille. Un compte est personnel."],
  ['3. Fonds et contrat', "Les dépôts sont conservés dans un contrat intelligent. ArcQuest n'a pas la garde de vos fonds : vous les retirez à tout moment depuis votre portefeuille. Les transactions sur la blockchain sont irréversibles."],
  ['4. Tâches et paiements', "Le créateur d'une tâche réserve l'intégralité des récompenses avant la publication. Il approuve ou refuse chaque soumission et motive tout refus. Une approbation déclenche un paiement onchain vers le portefeuille du participant. Les fonds non utilisés sont récupérables par le créateur après le délai prévu."],
  ['5. Conduite interdite', "Sont interdits : fausses preuves, comptes multiples, contenus illégaux, trompeurs ou haineux, tentatives de fraude, de contournement ou d'attaque du service. ArcQuest peut retirer un contenu et suspendre un compte."],
  ['6. Parrainage', "Le parrainage sert à suivre l'origine des inscriptions. Un filleul est dit actif après un premier paiement reçu. Toute manipulation du parrainage entraîne la suspension du compte."],
  ['7. Responsabilité', "Le service est fourni en l'état, sans garantie de disponibilité. ArcQuest n'est pas responsable des litiges entre créateurs et participants, ni des pertes liées à la blockchain, à un portefeuille ou à une erreur de saisie."],
  ['8. Modification', "Ces conditions peuvent évoluer. Les changements importants sont signalés dans l'application."],
]

const PRIVACY: [string, string][] = [
  ['1. Données collectées', "Adresse e-mail (si vous choisissez ce mode), adresse de portefeuille, nom d'utilisateur, soumissions et preuves envoyées (liens, images, notes), signalements, notifications. Les mots de passe sont stockés sous forme hachée, jamais en clair."],
  ['2. Utilisation', "Ces données servent à faire fonctionner le service : authentification, publication et validation des tâches, paiements, modération et prévention de la fraude."],
  ['3. Données publiques', "Les transactions sur la blockchain sont publiques et permanentes. Votre nom d'utilisateur est visible des autres membres, les preuves seulement du créateur concerné et de la modération."],
  ['4. Cookies', "Un seul cookie technique de session est utilisé pour vous garder connecté. Aucun cookie publicitaire."],
  ['5. Conservation', "Les données de compte sont conservées tant que le compte existe. Les sessions expirent après 30 jours."],
  ['6. Vos droits', "Vous pouvez demander l'accès, la rectification ou la suppression de vos données. Les données inscrites sur la blockchain ne peuvent pas être effacées."],
  ['7. Contact', "[Adresse de contact à renseigner par l'exploitant du service.]"],
]

export default function LegalPage({ kind, onBack }: { kind: 'terms' | 'privacy'; onBack: () => void }) {
  const sections = kind === 'terms' ? TERMS : PRIVACY
  return (
    <div className="min-h-dvh px-4 py-6" style={{ background: 'linear-gradient(180deg,#f4f6ff 0%,#fffcf7 52%,#f8f4ff 100%)' }}>
      <div className="max-w-2xl mx-auto space-y-4">
        <button onClick={onBack} className="min-h-[44px] inline-flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--accent)' }}>
          <ArrowLeft size={16} /> Retour
        </button>
        <h1 className="display font-bold text-3xl text-balance" style={{ color: 'var(--ink)' }}>
          {kind === 'terms' ? "Conditions d'utilisation" : 'Politique de confidentialité'}
        </h1>
        <div className="rounded-xl px-4 py-3 text-xs" style={{ background: 'rgba(255,205,131,0.25)', color: '#7a5608' }}>
          Texte modèle. À faire relire et adapter par un juriste avant toute ouverture au public ou usage avec de l'argent réel.
        </div>
        <Card className="p-5 space-y-5">
          {sections.map(([title, text]) => (
            <section key={title}>
              <h2 className="font-semibold text-sm mb-1" style={{ color: 'var(--ink)' }}>{title}</h2>
              <p className="text-sm text-pretty" style={{ color: 'var(--ink-2)' }}>{text}</p>
            </section>
          ))}
        </Card>
      </div>
    </div>
  )
}
