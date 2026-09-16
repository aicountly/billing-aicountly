import { useState } from 'react'
import { api, ApiError } from '../services/api'
import { useBilling } from '../context/BillingContext'
import { Button, Card, Notice } from '../ui'

/**
 * First use: five questions that decide the menu.
 *
 * They create no masters, no ledgers and no vouchers. A shop that answers "no
 * stock" simply does not get the stock screens; Inventory is untouched either
 * way, and nothing here is irreversible.
 */
const QUESTIONS = [
  {
    key: 'business_type',
    question: 'What sort of business is this?',
    options: [
      { value: 'retail', label: 'A shop' },
      { value: 'wholesale', label: 'Wholesale or distribution' },
      { value: 'trading', label: 'Trading' },
      { value: 'service', label: 'Services' },
      { value: 'other', label: 'Something else' },
    ],
  },
  { key: 'gst_registered', question: 'Are you registered for GST?', boolean: true },
  { key: 'maintains_stock', question: 'Do you keep stock?', boolean: true },
  { key: 'needs_purchase', question: 'Do you want to record purchases here?', boolean: true },
  { key: 'needs_bank_cash', question: 'Do you want to track cash and bank here?', boolean: true },
] as const

export default function Onboarding() {
  const { reload } = useBilling()
  const [answers, setAnswers] = useState<Record<string, unknown>>({
    business_type: 'retail',
    gst_registered: true,
    maintains_stock: true,
    needs_purchase: true,
    needs_bank_cash: true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function finish() {
    setSaving(true)
    setError(null)
    try {
      await api.post('v1/onboarding', {
        ...answers,
        // Payables follow from purchases: nobody wants one without the other.
        needs_payables: answers.needs_purchase,
      })
      reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: '34rem', margin: '3rem auto', padding: '0 1rem', display: 'grid', gap: '1rem' }}>
      <div>
        <h1 style={{ margin: 0, fontSize: '1.4rem' }}>Let's set this up</h1>
        <p style={{ color: 'var(--muted)', marginTop: '0.35rem' }}>
          Five questions, and they only decide what you see on screen. Nothing here creates an account, an item or an
          entry, and you can change any of it later.
        </p>
      </div>

      {error && <Notice tone="danger" title="Could not save">{error}</Notice>}

      {QUESTIONS.map((question) => (
        <Card key={question.key}>
          <div style={{ fontWeight: 600, marginBottom: '0.6rem' }}>{question.question}</div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {'boolean' in question && question.boolean
              ? [
                  { value: true, label: 'Yes' },
                  { value: false, label: 'No' },
                ].map((option) => (
                  <Button
                    key={String(option.value)}
                    tone={answers[question.key] === option.value ? 'primary' : 'secondary'}
                    onClick={() => setAnswers({ ...answers, [question.key]: option.value })}
                  >
                    {option.label}
                  </Button>
                ))
              : ('options' in question ? question.options : []).map((option) => (
                  <Button
                    key={option.value}
                    tone={answers[question.key] === option.value ? 'primary' : 'secondary'}
                    onClick={() => setAnswers({ ...answers, [question.key]: option.value })}
                  >
                    {option.label}
                  </Button>
                ))}
          </div>
        </Card>
      ))}

      <Button tone="primary" disabled={saving} onClick={finish} style={{ justifyContent: 'center', padding: '0.7rem' }}>
        {saving ? 'Setting up…' : 'Start using Billing'}
      </Button>
    </div>
  )
}
