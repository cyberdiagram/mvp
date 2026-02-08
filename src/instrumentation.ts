/**
 * Langfuse Instrumentation Setup
 *
 * Initializes OpenTelemetry with the Langfuse span processor for
 * observability tracking across all agent operations.
 *
 * MUST be imported before any other application modules to ensure
 * all spans are captured from startup.
 *
 * Environment variables required:
 * - LANGFUSE_SECRET_KEY
 * - LANGFUSE_PUBLIC_KEY
 * - LANGFUSE_BASE_URL (defaults to https://cloud.langfuse.com)
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

const langfuseEnabled =
  !!process.env.LANGFUSE_SECRET_KEY && !!process.env.LANGFUSE_PUBLIC_KEY;

let sdk: NodeSDK | null = null;

if (langfuseEnabled) {
  sdk = new NodeSDK({
    spanProcessors: [new LangfuseSpanProcessor()],
  });
  sdk.start();
  console.log('[Langfuse] Tracing enabled');
} else {
  console.log('[Langfuse] Tracing disabled (missing LANGFUSE_SECRET_KEY or LANGFUSE_PUBLIC_KEY)');
}

/**
 * Shuts down the OpenTelemetry SDK, flushing all pending spans to Langfuse.
 * Call this before process exit to ensure no traces are lost.
 */
export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
    console.log('[Langfuse] Tracing shut down');
  }
}
