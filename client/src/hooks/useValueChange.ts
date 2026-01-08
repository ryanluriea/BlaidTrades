import { useEffect, useRef, useState } from "react";

/**
 * Hook to detect value changes and trigger a brief "changed" state
 * Used for metric-level flash animations in trading terminals
 * 
 * @param value - The value to track for changes
 * @param flashDuration - How long the flash state lasts (ms), default 600ms
 * @returns isChanged - True when value just changed, auto-clears after flashDuration
 */
export function useValueChange<T>(
  value: T, 
  flashDuration: number = 600
): boolean {
  const prevValueRef = useRef<T>(value);
  const [isChanged, setIsChanged] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const prevValue = prevValueRef.current;
    
    // Compare values (handle null/undefined and objects)
    const valueChanged = (() => {
      if (prevValue === value) return false;
      if (prevValue == null && value == null) return false;
      if (typeof prevValue === 'number' && typeof value === 'number') {
        // For numbers, only flash if the change is meaningful
        return Math.abs(prevValue - value) > 0.001;
      }
      return prevValue !== value;
    })();

    if (valueChanged) {
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      // Set changed state
      setIsChanged(true);
      
      // Clear after duration
      timeoutRef.current = setTimeout(() => {
        setIsChanged(false);
      }, flashDuration);
    }
    
    prevValueRef.current = value;
    
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, flashDuration]);

  return isChanged;
}
