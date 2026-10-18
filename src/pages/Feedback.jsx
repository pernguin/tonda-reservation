import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { supabaseCustomers as roundSupabase } from '../supabaseCustomers'
import { isEligibleReservation, viewForFeedbackState, parseSubmitResult } from '../lib/feedbackFlow'

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
    if (!reservationId || !brand || restaurant !== 'tonda') {
      setInvalid(true)
      setLoading(false)
      return
    }

    // Reservations live in Tonda's own Supabase project.
    const { data: reservation, error: resErr } = await supabase
      .rpc('feedback_reservation', { p_id: reservationId })
      .maybeSingle()

    if (resErr || !isEligibleReservation(reservation)) {
      setInvalid(true)
      setLoading(false)
      return
    }

    // feedback is a shared table that only exists on Round's Supabase.
    const { data: state, error: stateErr } = await roundSupabase.rpc('feedback_state', {
      p_reservation_id: reservationId,
      p_customer_id: reservation.customer_id,
      p_restaurant: restaurant,
    })
    const view = stateErr ? 'invalid' : viewForFeedbackState(state)

    if (view === 'invalid') {
      setInvalid(true)
      setLoading(false)
      return
    }
    if (view === 'submitted') {
      setAlreadySubmitted(true)
      setLoading(false)
      return
    }

    setCustomerId(reservation.customer_id)
    setLoading(false)
  }

  function toggleTag(tag) {
    setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  async function handleSubmit() {
    setSubmitting(true)
    setSubmitError(null)

    const { data, error } = await roundSupabase.rpc('submit_feedback', {
      p_reservation_id: reservationId,
      p_customer_id: customerId,
      p_restaurant: restaurant,
      p_nps_score: npsScore,
      p_tags: selectedTags,
      p_comment: comment.trim() || null,
    })

    if (error) {
      console.error('feedback submit failed:', error.code, error.message, error.details, error.hint)
      if (error.code === '23505') {
        setAlreadySubmitted(true)
      } else if (String(error.message).includes('invalid_feedback')) {
        setInvalid(true)
      } else {
        setSubmitError('Something went wrong. Please try again.')
      }
      setSubmitting(false)
      return
    }

    const v = parseSubmitResult(data)
    if (v) {
      // send-voucher-email is only deployed on Round's Supabase project.
      const { error: emailError } = await roundSupabase.functions.invoke('send-voucher-email', {
        body: { reservation_id: reservationId },
      })
      if (emailError) console.error('send-voucher-email failed:', emailError)
      setVoucher(v)
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
