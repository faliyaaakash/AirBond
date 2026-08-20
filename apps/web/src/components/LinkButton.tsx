import { Link, type LinkProps } from 'react-router-dom';
import type { ButtonVariant } from './buttonStyles';
import { getButtonStyle } from './buttonStyles';

interface LinkButtonProps extends LinkProps {
  variant?: ButtonVariant;
}

export default function LinkButton({ variant = 'primary', style, ...rest }: LinkButtonProps) {
  return <Link style={{ ...getButtonStyle(variant), ...style }} {...rest} />;
}
