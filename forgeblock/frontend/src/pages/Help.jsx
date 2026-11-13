import { BookOpen, ChevronDown, Compass, Search } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../auth'
import { Button, Card, PageHeader, fieldClass } from '../components/ui'

// Questions shown only in study mode (research labels on).
const STUDY_FAQ = {
  topic: 'The ForgeBlock study',
  items: [
    ['What may ForgeBlock be used for during the study?', 'Only the approved research activities of the ForgeBlock study at DLSU-D. It is not used to verify signatures on actual legal, financial or official documents.'],
    ['I am an evaluation respondent. Which signatures do I use?', 'Your evaluation account and the signature samples prepared by the researchers. Never enroll your own or anyone else’s legal signature.'],
    ['What is a practice client?', 'A client with a made-up practice signature, used for testing and evaluation.'],
  ],
}

const FAQ = [
  {
    topic: 'Getting started',
    items: [
      ['How do I get an account?', 'Accounts are created by your administrator; there is no public sign-up. They register your email and role. Sign in with that email, by password (you get a temporary one to change at first sign-in) or with Microsoft or Google if your administrator turned them on.'],
      ['Can I sign in with Microsoft or Google?', 'Yes, when your administrator has set it up. Use the Microsoft or Google account with the same email your administrator registered. Other emails are refused.'],
      ['Where do I start?', 'Examiners start on My work, which lists the cases waiting for your decision. Administrators start on the Dashboard. Clients start on Home. The guided tour shows the rest; replay it with the button above.'],
      ['Who can see my records?', 'You see only your own clients, screenings and cases. Examiners also see clients an administrator shared with them. Administrators see everything.'],
      ['Why was I signed out?', 'For security you are signed out after 15 minutes without activity. Five wrong passwords in a row lock the account for 15 minutes; an administrator can unlock it sooner.'],
      ['What are the roles?', 'Examiners register clients, enroll their signatures, screen questioned signatures and decide Genuine or Forged. Administrators manage accounts, policy, the ledger and the system. Clients see only their own signatures and the screenings made in their name.'],
    ],
  },
  {
    topic: 'Clients and references',
    items: [
      ['How many reference signatures does a client need?', 'At least 7 per module, 20 recommended, 30 at most. More signatures make screening more reliable. The badge on the signature card shows this: Not ready (fewer than 7), Ready (7 to 19) and Strong (20 or more).'],
      ['Why add signatures on different days?', 'A signature changes a little from day to day. When the references come from two or more sittings, ForgeBlock learns that natural variation and is less likely to call a genuine signature Inconsistent. The signature card suggests this when all references were added in one sitting. With the printed sheet, fill a second sheet on another day.'],
      ['What are the practice boxes on the enrollment sheet?', 'The first signatures of a sitting are often stiffer than the rest, so the client warms up in the 2 practice boxes first. They are never cropped or added as references.'],
      ['What does “Looks different from the others” mean?', 'That reference is much less similar to the client’s other references than they are to each other. If it is the client’s own signature and a clean capture, keep it: natural variation makes screening more reliable. Remove it only if the capture is bad (smudged, cut off, blurry) or it is not the client’s signature.'],
      ['What makes a good scan?', 'One signature per image, dark ink on plain paper, scanned at 300 dpi or photographed straight on in good light. Each upload gets a quality score; blank, tiny or blurry images are refused.'],
      ['How do I delete a client?', 'Administrators: right-click the client in the Clients list (or press ⋯) and choose Delete client, then confirm. Their signatures and images are removed; the ledger keeps only hashes, so the chain stays valid.'],
    ],
  },
  {
    topic: 'Screening and decisions',
    items: [
      ['What do Consistent, Inconclusive and Inconsistent mean?', 'Consistent: the signature matches the client’s references. Inconsistent: it does not. Inconclusive: it is too close to the thresholds to lean either way. Inconclusive and Inconsistent screenings open a case for the examiner’s decision.'],
      ['Who decides if a signature is genuine or forged?', 'The examiner. ForgeBlock’s result is decision support. In the case, the examiner chooses Genuine or Forged and writes notes; the decision closes the case and is sealed in the ledger.'],
      ['What happens if I screen the same signature again?', 'If the same file (or the same stroke data) was already decided, ForgeBlock shows “Decided: Genuine” or “Decided: Forged” with the examiner’s notes, and no new case is opened. The model’s own result stays the same, so the evaluation figures stay honest.'],
      ['What does “Add as reference” do?', 'After a Genuine decision, the examiner can add the questioned signature to the client’s references, so later screenings can match it better. It is optional.'],
      ['How is the confidence score measured?', 'For each measure (cosine, Euclidean and Manhattan for static; cosine and Euclidean for dynamic), ForgeBlock checks how far past the threshold the signature is, compared with the distance from the threshold to a perfect match. These are averaged and shown from 0 to 100%. A signature that passes by only a little gets a low confidence and may be Inconclusive.'],
      ['What are personal thresholds?', 'With 7 or more references, ForgeBlock compares the client’s references with each other and sets the threshold from how much their own signatures vary (mean minus 1.5 times the spread, within fixed limits). They change whenever references are added or removed. With fewer than 7, standard thresholds are used.'],
      ['What is the difference between static and dynamic?', 'Static screens a scanned or photographed signature on paper. Dynamic screens a signature written live with a pen on a tablet, using the movement, timing and pressure. They are two separate modules; ForgeBlock does not combine them into one score.'],
    ],
  },
  {
    topic: 'Ledger and receipts',
    items: [
      ['What is the ledger for?', 'It makes the records tamper evident. Every screening and every decision is hashed with SHA-256 and sealed in a block that also holds the previous block’s hash. If anyone edits a record in the database, its hash stops matching and the chain shows where it broke.'],
      ['Who validates the ledger?', 'ForgeBlock checks it automatically once a day. Administrators can also press Check now on the Ledger page. Anyone with a receipt code can check one record on the ForgeBlock home page.'],
      ['What is a receipt code?', 'A code like FB-7K2Q-M9XA given to each screening. It shows no names or images, only whether the record is unchanged.'],
    ],
  },
  {
    topic: 'Privacy',
    items: [
      ['Can I download signatures or export data?', 'No. Signatures are shown inside ForgeBlock only.'],
      ['How long is data kept?', 'Each client has a retention date set by the administrator. After it, their reference signatures and stored images are deleted automatically. The ledger keeps only hashes, so the chain stays valid.'],
      ['How do I ask for my data to be deleted?', 'Clients can press Request deletion on their Profile page. An administrator is notified.'],
    ],
  },
]

export default function Help() {
  const { user, setTourOpen } = useAuth()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const term = q.trim().toLowerCase()
  const all = user.study_mode ? [...FAQ, STUDY_FAQ] : FAQ
  const topics = all.map((t) => ({ ...t, items: t.items.filter(([a, b]) => !term || a.toLowerCase().includes(term) || b.toLowerCase().includes(term)) })).filter((t) => t.items.length)
  return (
    <>
      <PageHeader title="Help Center" description="Search, or browse by topic.">
        <Button variant="secondary" onClick={() => setTourOpen('full')}><Compass className="h-4 w-4" /> Replay full tour</Button>
      </PageHeader>
      <div className="relative mb-6 max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the help articles" aria-label="Search the help articles" className={`${fieldClass} w-full rounded-[12px] py-3 pl-10 pr-4 shadow-raised`} />
      </div>
      <div className="space-y-6">
        {topics.length === 0 && <p className="text-sm text-slate-500">No articles match “{q}”.</p>}
        {topics.map((t) => (
          <Card key={t.topic} icon={BookOpen} title={t.topic} bodyClass="p-0">
            <ul className="divide-y divide-slate-100">
              {t.items.map(([question, answer]) => {
                const isOpen = open === question || !!term
                return (
                  <li key={question}>
                    <button onClick={() => setOpen(open === question ? null : question)} className="flex w-full items-center justify-between gap-3 px-[22px] py-3.5 text-left text-[15px] font-medium text-ink transition-colors hover:bg-[#f7fafd]">
                      {question}
                      <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && <p className="px-5 pb-4 text-[15px] leading-relaxed text-slate-600">{answer}</p>}
                  </li>
                )
              })}
            </ul>
          </Card>
        ))}
      </div>
    </>
  )
}
