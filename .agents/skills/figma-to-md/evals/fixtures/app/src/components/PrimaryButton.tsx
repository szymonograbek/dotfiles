type PrimaryButtonProps = {
  label: string;
};

export function PrimaryButton({ label }: PrimaryButtonProps) {
  return <button className="primary-button">{label}</button>;
}
