import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { supabaseCustomers as roundSupabase } from '../supabaseCustomers'

const ROUND_SUPABASE_URL = import.meta.env.VITE_ROUND_SUPABASE_URL
const ROUND_SUPABASE_ANON_KEY = import.meta.env.VITE_ROUND_SUPABASE_ANON_KEY

const PIZZA_WORDS = ['MARGHERITA', 'DIAVOLA', 'QUATTRO', 'BUFALA', 'NAPOLI', 'FORNO', 'ROMANA', 'TONDA', 'SFORNO', 'IMPASTO', 'CORNICIONE', 'BISCOTTO', 'CAPUTO', 'INFERNO', 'SALAMI', 'ANCHOVY', 'BURRATA', 'NDUJA', 'RICOTTA', 'BASILIO']

function generateVoucherCode() {
  const word = PIZZA_WORDS[Math.floor(Math.random() * PIZZA_WORDS.length)]
  const num = String(Math.floor(Math.random() * 100)).padStart(2, '0')
  return `${word}-${num}`
}

// Raw REST POST instead of the supabase-js client, which appends a
// ?columns= query param to insert requests that was triggering RLS 42501s.
// Always targets Round's Supabase, since the shared `feedback` table only
// exists there (Tonda's own project only holds its own reservations).
async function insertFeedback(payload) {
  const res = await fetch(`${ROUND_SUPABASE_URL}/rest/v1/feedback`, {
    method: 'POST',
    headers: {
      apikey: ROUND_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${ROUND_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(payload),
  })

  const body = await res.json().catch(() => null)

  if (!res.ok) {
    const error = Array.isArray(body) ? body[0] : body
    return { data: null, error: error || { message: `HTTP ${res.status}` } }
  }

  return { data: Array.isArray(body) ? body[0] : body, error: null }
}

const BRANDS = {
  round: {
    primary: '#8B1A1A',
    bg: '#F0EBE1',
    text: '#1a1a1a',
    muted: '#8a8378',
    cardBg: '#ffffff',
    pillInactiveBg: '#f3f4f6',
    pillInactiveText: '#6b7280',
    name: 'Round Pizza Napoletana',
    reviewUrl: 'https://share.google/CKhGF6X9eJbg1i8Rw',
  },
  tonda: {
    primary: 'var(--color-accent)',
    bg: 'var(--color-header-bg)',
    text: 'var(--color-header-text)',
    muted: 'var(--color-footer-text)',
    cardBg: 'var(--color-footer-card-bg)',
    pillInactiveBg: 'var(--color-footer-card-bg)',
    pillInactiveText: 'var(--color-footer-text)',
    name: 'Tonda Pizza Romana',
    reviewUrl: 'https://share.google/1lw7ugj1qaf57dJXg',
  },
}

const DETRACTOR_TAGS = ['Price', 'Food quality', 'Service', 'Ambience', 'Location / accessibility', 'Wait time']
const PROMOTER_TAGS = ['Food', 'Service', 'Ambience', 'Value for money']

export default function Feedback() {
  const [searchParams] = useSearchParams()
  const reservationId = searchParams.get('reservation')
  const restaurant = searchParams.get('restaurant')
  const brand = BRANDS[restaurant]

  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)
  const [alreadySubmitted, setAlreadySubmitted] = useState(false)
  const [isRepeatFeedback, setIsRepeatFeedback] = useState(false)
  const [customerId, setCustomerId] = useState(null)

  const [step, setStep] = useState('nps')
  const [npsScore, setNpsScore] = useState(null)
  const [selectedTags, setSelectedTags] = useState([])
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [voucher, setVoucher] = useState(null)

  useEffect(() => { init() }, [])

  async function init() {
    if (!reservationId || !brand) {
      setInvalid(true)
      setLoading(false)
      return
    }

    // Reservations live in Tonda's own Supabase project.
    const { data: reservation, error: resErr } = await supabase
      .from('reservations')
      .select('id, customer_id, status')
      .eq('id', reservationId)
      .maybeSingle()

    if (resErr || !reservation || reservation.status !== 'completed') {
      setInvalid(true)
      setLoading(false)
      return
    }

    // feedback is a shared table that only exists on Round's Supabase.
    const { data: ownFeedback } = await roundSupabase
      .from('feedback')
      .select('id')
      .eq('reservation_id', reservationId)
      .limit(1)

    if (ownFeedback && ownFeedback.length > 0) {
      setAlreadySubmitted(true)
      setLoading(false)
      return
    }

    const { data: pastFeedback } = await roundSupabase
      .from('feedback')
      .select('id')
      .eq('customer_id', reservation.customer_id)
      .eq('restaurant', restaurant)
      .limit(1)

    setIsRepeatFeedback(pastFeedback && pastFeedback.length > 0)
    setCustomerId(reservation.customer_id)
    setLoading(false)
  }

  function toggleTag(tag) {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  async function handleSubmit() {
    setSubmitting(true)
    setSubmitError(null)

    let voucherCode = null
    let voucherExpiresAt = null
    if (!isRepeatFeedback) {
      voucherCode = generateVoucherCode()
      const expires = new Date()
      expires.setMonth(expires.getMonth() + 3)
      voucherExpiresAt = expires.toISOString()
    }

    const basePayload = {
      reservation_id: reservationId,
      customer_id: customerId,
      restaurant,
      nps_score: npsScore,
      tags: selectedTags,
      comment: comment.trim() || null,
      voucher_expires_at: voucherExpiresAt,
    }

    let { data, error } = await insertFeedback({ ...basePayload, voucher_code: voucherCode })

    if (error && error.code === '23505' && voucherCode) {
      voucherCode = generateVoucherCode()
      ;({ data, error } = await insertFeedback({ ...basePayload, voucher_code: voucherCode }))
    }

    if (error) {
      console.error('feedback insert failed:', error.code, error.message, error.details, error.hint)
      setSubmitError('Something went wrong. Please try again.')
      setSubmitting(false)
      return
    }

    if (voucherCode) {
      try {
        // send-voucher-email is only deployed on Round's Supabase project.
        await roundSupabase.functions.invoke('send-voucher-email', {
          body: {
            reservation_id: reservationId,
            customer_id: customerId,
            restaurant,
            voucher_code: voucherCode,
            voucher_expires_at: voucherExpiresAt,
          },
        })
      } catch (err) {
        console.error(err)
      }
      setVoucher({ code: voucherCode, expiresAt: voucherExpiresAt })
    }

    setSubmitting(false)
    setStep('thanks')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F0EBE1' }}>
        <p className="text-sm" style={{ color: '#8a8378' }}>Loading...</p>
      </div>
    )
  }

  if (invalid) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8" style={{ backgroundColor: '#F0EBE1' }}>
        <p className="text-gray-500 text-sm">This link isn't valid.</p>
      </div>
    )
  }

  if (alreadySubmitted) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-8" style={{ backgroundColor: brand.bg }}>
        <p className="text-lg" style={{ color: brand.text }}>You've already submitted feedback — thank you!</p>
      </div>
    )
  }

  const isPromoter = npsScore >= 6
  const pillOptions = npsScore <= 5 ? DETRACTOR_TAGS : PROMOTER_TAGS

  function pillStyle(active) {
    return active
      ? { backgroundColor: brand.primary, color: '#ffffff' }
      : { backgroundColor: brand.pillInactiveBg, color: brand.pillInactiveText }
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: brand.bg }}>
      <div className="max-w-lg mx-auto px-8 py-16">
        <p className="text-xs tracking-widest uppercase mb-2" style={{ color: brand.primary }}>
          {brand.name}
        </p>

        {step === 'nps' && (
          <>
            <h1 className="text-2xl font-light mb-8" style={{ color: brand.text }}>
              How likely are you to recommend us to a friend or family?
            </h1>
            <div className="flex flex-wrap gap-2 mb-8">
              {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
                <button
                  key={n}
                  onClick={() => setNpsScore(n)}
                  className="w-10 h-10 text-sm font-medium rounded transition-colors"
                  style={npsScore === n ? { backgroundColor: brand.primary, color: '#ffffff' } : { backgroundColor: brand.pillInactiveBg, color: brand.pillInactiveText }}
                >
                  {n}
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep('details')}
              disabled={npsScore === null}
              className="w-full py-3 text-sm tracking-widest uppercase text-white transition-opacity hover:opacity-90 disabled:opacity-40 rounded"
              style={{ backgroundColor: brand.primary }}
            >
              Continue
            </button>
          </>
        )}

        {step === 'details' && (
          <>
            <h1 className="text-2xl font-light mb-8" style={{ color: brand.text }}>
              {isPromoter ? 'What did you enjoy most?' : 'What could we have done better?'}
            </h1>
            <div className="flex flex-wrap gap-2 mb-6">
              {pillOptions.map(tag => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className="px-4 py-2 text-xs font-medium tracking-wide rounded-full transition-colors"
                  style={pillStyle(selectedTags.includes(tag))}
                >
                  {tag}
                </button>
              ))}
            </div>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Tell us more (optional)"
              rows={4}
              className="w-full p-4 text-sm rounded mb-6 focus:outline-none"
              style={{ backgroundColor: brand.cardBg, color: brand.text }}
            />
            {submitError && (
              <p className="text-sm mb-4" style={{ color: brand.primary }}>{submitError}</p>
            )}
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-3 text-sm tracking-widest uppercase text-white transition-opacity hover:opacity-90 disabled:opacity-40 rounded"
              style={{ backgroundColor: brand.primary }}
            >
              {submitting ? 'Submitting...' : 'Submit'}
            </button>
          </>
        )}

        {step === 'thanks' && (
          <>
            <h1 className="text-2xl font-light mb-6" style={{ color: brand.text }}>
              Thank you for your feedback!
            </h1>

            {voucher && (
              <div className="rounded-2xl p-6 mb-6 border" style={{ backgroundColor: brand.cardBg, borderColor: brand.primary }}>
                <p className="text-sm mb-2" style={{ color: brand.muted }}>Your free Margherita voucher:</p>
                <p className="text-2xl font-medium tracking-widest mb-4" style={{ color: brand.primary }}>{voucher.code}</p>
                <p className="text-sm" style={{ color: brand.text }}>
                  Valid at {brand.name} until {new Date(voucher.expiresAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}. Show this to your server on your next visit.
                </p>
                <p className="text-sm mt-2" style={{ color: brand.muted }}>
                  Minimum spend of RM100 applies.
                </p>
              </div>
            )}

            {!voucher && !isPromoter && (
              <p className="text-sm mb-6" style={{ color: brand.text }}>
                We appreciate your honesty. We'll use this to improve.
              </p>
            )}

            {isPromoter && (
              <a
                href={brand.reviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full py-3 text-sm tracking-widest uppercase text-white text-center transition-opacity hover:opacity-90 rounded"
                style={{ backgroundColor: brand.primary }}
              >
                Leave us a Google Review
              </a>
            )}
          </>
        )}
      </div>
    </div>
  )
}
