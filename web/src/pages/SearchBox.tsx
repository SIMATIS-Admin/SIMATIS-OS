import { Icon } from '../icons.js';

type Props = { value: string; onChange: (value: string) => void; placeholder: string };

export function SearchBox({ value, onChange, placeholder }: Props) {
  return (
    <label className="search">
      <Icon name="search" />
      <input
        className="input"
        type="search"
        placeholder={placeholder}
        aria-label={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
