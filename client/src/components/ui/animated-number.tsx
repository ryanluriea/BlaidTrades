import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
}

export function AnimatedNumber({
  value,
  duration = 500,
  decimals = 2,
  className,
  prefix = "",
  suffix = "",
}: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const previousValueRef = useRef(value);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const isFirstRenderRef = useRef(true);

  useEffect(() => {
    const previousValue = previousValueRef.current;
    
    if (previousValue === value) return;

    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      setDisplayValue(value);
      previousValueRef.current = value;
      return;
    }

    const startValue = previousValue;
    const endValue = value;
    const difference = endValue - startValue;

    const animate = (currentTime: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = currentTime;
      }

      const elapsed = currentTime - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      const easeOutQuad = 1 - Math.pow(1 - progress, 3);
      const currentValue = startValue + difference * easeOutQuad;

      setDisplayValue(currentValue);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayValue(endValue);
        previousValueRef.current = endValue;
        startTimeRef.current = null;
      }
    };

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    
    startTimeRef.current = null;
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [value, duration]);

  useEffect(() => {
    previousValueRef.current = value;
    setDisplayValue(value);
  }, []);

  const formattedValue = displayValue.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span className={cn("tabular-nums", className)}>
      {prefix}
      {formattedValue}
      {suffix}
    </span>
  );
}

interface AnimatedDigitProps {
  digit: string;
  duration?: number;
}

function AnimatedDigit({ digit, duration = 400 }: AnimatedDigitProps) {
  const [currentDigit, setCurrentDigit] = useState(digit);
  const [isAnimating, setIsAnimating] = useState(false);
  const [direction, setDirection] = useState<"up" | "down">("up");
  const prevDigitRef = useRef(digit);

  useEffect(() => {
    if (prevDigitRef.current !== digit) {
      const prevNum = parseInt(prevDigitRef.current) || 0;
      const newNum = parseInt(digit) || 0;
      setDirection(newNum > prevNum ? "up" : "down");
      setIsAnimating(true);
      
      setTimeout(() => {
        setCurrentDigit(digit);
        setIsAnimating(false);
      }, duration);
      
      prevDigitRef.current = digit;
    }
  }, [digit, duration]);

  if (!isAnimating) {
    return <span className="inline-block">{currentDigit}</span>;
  }

  return (
    <span className="inline-block relative overflow-hidden h-[1em]">
      <span
        className={cn(
          "inline-block transition-transform",
          direction === "up" ? "animate-digit-roll-up" : "animate-digit-roll-down"
        )}
        style={{ animationDuration: `${duration}ms` }}
      >
        {prevDigitRef.current}
      </span>
      <span
        className={cn(
          "inline-block absolute left-0 transition-transform",
          direction === "up" ? "animate-digit-enter-up" : "animate-digit-enter-down"
        )}
        style={{ animationDuration: `${duration}ms` }}
      >
        {digit}
      </span>
    </span>
  );
}

interface RollingNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  className?: string;
  showSign?: boolean;
}

export function RollingNumber({
  value,
  duration = 400,
  decimals = 2,
  className,
  showSign = true,
}: RollingNumberProps) {
  const isNegative = value < 0;
  const absValue = Math.abs(value);
  
  const formattedValue = absValue.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  const sign = showSign ? (isNegative ? "-" : "+") : (isNegative ? "-" : "");
  const chars = formattedValue.split("");

  return (
    <span className={cn("tabular-nums font-mono inline-flex", className)}>
      <span>{sign}$</span>
      {chars.map((char, index) => {
        if (char === "," || char === ".") {
          return <span key={index}>{char}</span>;
        }
        return <AnimatedDigit key={index} digit={char} duration={duration} />;
      })}
    </span>
  );
}

interface SmoothCounterProps {
  value: number;
  duration?: number;
  decimals?: number;
  className?: string;
  showSign?: boolean;
  showCurrency?: boolean;
}

export function SmoothCounter({
  value,
  duration = 600,
  decimals = 2,
  className,
  showSign = true,
  showCurrency = true,
}: SmoothCounterProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const displayValueRef = useRef(value);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const targetValueRef = useRef(value);
  const isFirstRenderRef = useRef(true);

  useEffect(() => {
    displayValueRef.current = displayValue;
  }, [displayValue]);

  useEffect(() => {
    if (targetValueRef.current === value) return;
    targetValueRef.current = value;

    const startValue = displayValueRef.current;
    const endValue = value;
    const difference = endValue - startValue;

    if (Math.abs(difference) < 0.001) {
      setDisplayValue(endValue);
      return;
    }

    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      setDisplayValue(endValue);
      displayValueRef.current = endValue;
      return;
    }

    const animate = (currentTime: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = currentTime;
      }

      const elapsed = currentTime - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      const easeOutCubic = 1 - Math.pow(1 - progress, 3);
      const currentValue = startValue + difference * easeOutCubic;

      setDisplayValue(currentValue);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayValue(endValue);
        startTimeRef.current = null;
      }
    };

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    
    startTimeRef.current = null;
    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [value, duration]);

  const isNegative = displayValue < 0;
  const absValue = Math.abs(displayValue);
  const formattedValue = absValue.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  const sign = showSign ? (isNegative ? "-" : "+") : (isNegative ? "-" : "");
  const currency = showCurrency ? "$" : "";

  return (
    <span className={cn("tabular-nums font-mono", className)}>
      {sign}{currency}{formattedValue}
    </span>
  );
}
