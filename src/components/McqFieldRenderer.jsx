/**
 * McqFieldRenderer.jsx
 *
 * Reusable component for rendering an MCQ field value — either text or an image.
 *
 * Detection Logic:
 *   • If `value` starts with "https://firebasestorage.googleapis.com" or
 *     "https://storage.googleapis.com" → render as <img> with zoom support.
 *   • Otherwise → render as plain text inside a <span>.
 *
 * Props:
 *   value     {string}   — The field value (text string or Firebase Storage URL)
 *   className {string}   — Optional extra CSS classes on the wrapper
 *   onZoom    {Function} — Optional callback(url) invoked on image click (for lightbox)
 *   isOption  {boolean}  — When true, applies compact option-specific image sizing
 *   altText   {string}   — Alt text for the <img> (defaults to "MCQ image")
 */

/**
 * Returns true if the string is a Firebase / Google Cloud Storage download URL.
 * This is the single source-of-truth detection function for the entire app.
 *
 * @param {*} value
 * @returns {boolean}
 */
export const isFirebaseUrl = (value) =>
  typeof value === 'string' &&
  (
    value.startsWith('https://firebasestorage.googleapis.com') ||
    value.startsWith('https://storage.googleapis.com')
  );

/**
 * McqFieldRenderer component.
 */
const McqFieldRenderer = ({
  value,
  className = '',
  onZoom = null,
  isOption = false,
  altText = 'MCQ image',
}) => {
  if (!value) {
    return <span className={`text-gray-400 italic text-sm ${className}`}>(empty)</span>;
  }

  if (isFirebaseUrl(value)) {
    return (
      <div className={`inline-block ${className}`}>
        <img
          src={value}
          alt={altText}
          title={onZoom ? 'Click to zoom' : undefined}
          onClick={onZoom ? () => onZoom(value) : undefined}
          className={[
            'rounded border border-gray-200 object-contain bg-white',
            isOption
              ? 'max-h-20 max-w-[180px]'   // compact for option labels
              : 'max-h-48 max-w-full',       // larger for question body
            onZoom ? 'cursor-pointer hover:opacity-90 hover:scale-[1.02] transition' : '',
          ].join(' ')}
          style={{ display: 'block' }}
          onError={(e) => {
            // Graceful fallback: show a broken-image placeholder
            e.target.style.display = 'none';
            e.target.nextSibling && (e.target.nextSibling.style.display = 'inline');
          }}
        />
        {/* Fallback text shown if image fails to load */}
        <span
          className="text-xs text-red-500 italic hidden"
          style={{ display: 'none' }}
        >
          ⚠ Image failed to load
        </span>
      </div>
    );
  }

  // Plain text
  return (
    <span className={`text-gray-800 ${className}`}>{value}</span>
  );
};

export default McqFieldRenderer;
