import type { JSX } from 'react'

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function ErrorBanner(props: { message: string }): JSX.Element {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
      Failed to load data: {props.message}
    </div>
  )
}
