import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      {children}
    </svg>
  )
}

export function PulseIcon(props: IconProps) { return <Icon {...props}><path d="M3 12h4l2.2-6 4.1 12 2.2-6H21" /></Icon> }
export function EventsIcon(props: IconProps) { return <Icon {...props}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M7 9h3M7 15h3M14 9h3M14 15h3" /></Icon> }
export function RefreshIcon(props: IconProps) { return <Icon {...props}><path d="M20 7v5h-5" /><path d="M18.2 16a8 8 0 1 1 .5-8.5L20 12" /></Icon> }
export function ChevronIcon(props: IconProps) { return <Icon {...props}><path d="m9 18 6-6-6-6" /></Icon> }
export function ArrowLeftIcon(props: IconProps) { return <Icon {...props}><path d="m15 18-6-6 6-6" /><path d="M9 12h11" /></Icon> }
export function ExternalIcon(props: IconProps) { return <Icon {...props}><path d="M15 3h6v6M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></Icon> }
export function CopyIcon(props: IconProps) { return <Icon {...props}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" /></Icon> }
export function CheckIcon(props: IconProps) { return <Icon {...props}><path d="m5 12 4 4L19 6" /></Icon> }
export function AlertIcon(props: IconProps) { return <Icon {...props}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></Icon> }
export function EmptyIcon(props: IconProps) { return <Icon {...props}><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" /><path d="m4 7.5 8 4.5 8-4.5M12 12v9" /></Icon> }
