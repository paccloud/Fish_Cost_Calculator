const TONE_CLASS = {
  reference: '',
  yours: 'stamp-yours',
  community: 'stamp-community',
};

/**
 * A small uppercase label that says where a number came from: `MAB-37 · 41–49%`,
 * `Your yield · 44%`, `Community · 12 cuts`. Also the state of a record ("Saved on this phone").
 *
 * tone: 'reference' (a published yield, the default), 'yours' or 'community'. The words must say
 * the same thing as the colour. It is a printed label, not a button: three or four words at most.
 */
export default function Stamp({ tone = 'reference', children }) {
  return <span className={`stamp ${TONE_CLASS[tone] ?? ''}`.trim()}>{children}</span>;
}
