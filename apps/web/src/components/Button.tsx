import type { ButtonVariant } from './buttonStyles';
import { getButtonStyle } from './buttonStyles';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export default function Button({ variant = 'primary', style, disabled, ...rest }: ButtonProps) {
  return <button style={{ ...getButtonStyle(variant, disabled), ...style }} disabled={disabled} {...rest} />;
}
