import './ShinyText.css';

interface ShinyTextProps {
  text: string;
  disabled?: boolean;
  speed?: number;
  className?: string;
}

const ShinyText: React.FC<ShinyTextProps> = ({ text, disabled = false, speed = 5, className = '' }) => {
  return (
    <span className={`shiny-text ${disabled ? 'shiny-text--disabled' : ''} ${className}`} style={{ animationDuration: `${speed}s` }}>
      {text}
    </span>
  );
};

export default ShinyText;
