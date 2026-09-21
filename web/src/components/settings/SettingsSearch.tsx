/**
 * Find a setting by typing what you call it.
 *
 * The whole catalogue is already in the bundle, so this is a local, synchronous
 * filter — no debounce against a network, no spinner, no round trip. What IS
 * scoped is the result set: it searches only the categories and children this
 * Billing profile may reach, so a biller never finds their way to a row the API
 * would refuse.
 *
 * Keyboard: Ctrl/Cmd+K or "/" focuses it from anywhere on the page, the arrow
 * keys walk the list, Enter opens the highlighted row, Escape clears and closes.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Search } from 'lucide-react'
import {
  countSettingsMatches,
  searchSettings,
  type SettingsAudience,
  type SettingsHit,
} from '../../config/settingsCatalog'
import { trackEvent } from '../../utils/analytics'

const MAX_RESULTS = 8

/**
 * Mark the part of the label the query found.
 *
 * The whole phrase where it is there, otherwise the longest single word of the
 * query that is — "invoice number" matching a row called "Document numbering"
 * should still show the reader which word did it.
 */
function highlight(text: string, query: string): ReactNode {
  const haystack = text.toLowerCase()
  const phrase = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (phrase.length < 2) return text

  const needle =
    haystack.includes(phrase)
      ? phrase
      : phrase
          .split(' ')
          .filter((word) => word.length > 1 && haystack.includes(word))
          .sort((a, b) => b.length - a.length)[0]

  if (!needle) return text
  const at = haystack.indexOf(needle)

  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  )
}

export function SettingsSearch({ audience }: { audience: SettingsAudience }) {
  const navigate = useNavigate()
  const listId = useId()

  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  const box = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLInputElement | null>(null)

  const results = useMemo(() => searchSettings(term, audience, MAX_RESULTS), [term, audience])
  const totalMatches = useMemo(() => countSettingsMatches(term, audience), [term, audience])

  // Ctrl/Cmd+K from anywhere, and "/" when the caret is not already in a field
  // — otherwise typing a slash into any input on the page would steal focus.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        input.current?.focus()
        input.current?.select()
      } else if (event.key === '/' && !typing) {
        event.preventDefault()
        input.current?.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  // One event per settled query rather than one per keystroke. The term itself
  // is not sent: it is a person describing their own configuration.
  useEffect(() => {
    if (term.trim().length < 2) return undefined
    const timer = window.setTimeout(() => {
      trackEvent('billing_settings_search', { term_length: term.trim().length, results: totalMatches })
    }, 600)
    return () => window.clearTimeout(timer)
  }, [term, totalMatches])

  function choose(hit: SettingsHit) {
    setOpen(false)
    setTerm('')
    navigate(hit.to)
  }

  const showing = open && term.trim().length >= 2

  return (
    <div className="billing-settings__search" ref={box}>
      <div className="billing-settings__search-field">
        <Search size={16} aria-hidden />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded={showing}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Search settings"
          placeholder="Search settings..."
          value={term}
          onChange={(event) => {
            setTerm(event.target.value)
            setActive(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              if (term) {
                setTerm('')
              } else {
                input.current?.blur()
              }
              setOpen(false)
              return
            }
            if (!showing || results.length === 0) return
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActive((index) => (index + 1) % results.length)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((index) => (index - 1 + results.length) % results.length)
            } else if (event.key === 'Enter') {
              event.preventDefault()
              choose(results[active])
            }
          }}
        />
        <kbd className="billing-settings__kbd">Ctrl K</kbd>
      </div>

      {/* Announced without stealing focus, so a screen reader hears how many
          settings matched before deciding to walk the list. */}
      <span className="billing-sr-only" role="status">
        {showing
          ? totalMatches === 0
            ? 'No settings matched'
            : `${totalMatches} ${totalMatches === 1 ? 'setting' : 'settings'} matched`
          : ''}
      </span>

      {showing && (
        <div className="billing-settings__results" id={listId} role="listbox" aria-label="Matching settings">
          {results.length === 0 && (
            <p className="billing-settings__results-empty">
              Nothing in Settings matches “{term.trim()}”.
            </p>
          )}

          {results.map((hit, index) => {
            const Icon = hit.category.icon
            return (
              <button
                key={hit.key}
                type="button"
                role="option"
                aria-selected={index === active}
                className="billing-settings__result"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(hit)}
              >
                <span className={`billing-settings__result-mark billing-settings__icon--${hit.category.accent}`}>
                  <Icon size={16} aria-hidden />
                </span>
                <span style={{ minWidth: 0 }}>
                  {hit.child && <span className="billing-settings__result-where">{hit.category.title}</span>}
                  <span className="billing-settings__result-label">{highlight(hit.label, term)}</span>
                  <span className="billing-settings__result-detail">{hit.description}</span>
                </span>
                <ChevronRight size={16} aria-hidden style={{ color: 'var(--billing-muted)' }} />
              </button>
            )
          })}

          {totalMatches > results.length && (
            <p className="billing-settings__results-foot">
              Showing {results.length} of {totalMatches}. Keep typing to narrow it down.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
