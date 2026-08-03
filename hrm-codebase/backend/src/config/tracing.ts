import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { TraceExporter as GoogleCloudTraceExporter } from "@google-cloud/opentelemetry-cloud-trace-exporter";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { logger } from "../modules/logger.js";
import {
  createTracingSampler,
  getTraceProjectId,
  getTracingSamplingConfig,
} from "./tracing-sampling.js";

type TracingHandle = {
  enabled: boolean;
  shutdown: () => Promise<void>;
};

let sdk: NodeSDK | undefined;

const getOtlpExporterEndpoint = (): string | undefined => {
  const endpoint = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];

  if (endpoint === undefined || endpoint.trim() === "") {
    return undefined;
  }

  return endpoint.trim();
};

const createTraceExporter = (
  exporterEndpoint: string | undefined,
  googleCloudProjectId: string | undefined,
) => {
  if (exporterEndpoint !== undefined) {
    return new OTLPTraceExporter({ url: exporterEndpoint });
  }

  if (googleCloudProjectId !== undefined) {
    return new GoogleCloudTraceExporter({ projectId: googleCloudProjectId });
  }

  return new GoogleCloudTraceExporter();
};

export const initTracing = (): TracingHandle => {
  if (process.env["OTEL_ENABLED"] !== "true") {
    return {
      enabled: false,
      shutdown: async () => undefined,
    };
  }

  try {
    const serviceName = process.env["OTEL_SERVICE_NAME"] ?? "nail-salon-backend";
    const exporterEndpoint = getOtlpExporterEndpoint();
    const googleCloudProjectId = getTraceProjectId();
    const samplingConfig = getTracingSamplingConfig();
    const traceExporter = createTraceExporter(exporterEndpoint, googleCloudProjectId);

    sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
      }),
      traceExporter,
      sampler: createTracingSampler(samplingConfig),
      instrumentations: [getNodeAutoInstrumentations()],
    });

    sdk.start();
    logger.info(
      {
        serviceName,
        exporter: exporterEndpoint ? "otlp-http" : "google-cloud-trace",
        exporterEndpointConfigured: exporterEndpoint !== undefined,
        traceProjectConfigured: googleCloudProjectId !== undefined,
        rootSamplingRatio: samplingConfig.rootRatio,
        attendanceWriteSamplingRatio: samplingConfig.attendanceWriteRatio,
        attendanceReadSamplingRatio: samplingConfig.attendanceReadRatio,
        employeeTimeTrackingWriteSamplingRatio: samplingConfig.employeeTimeTrackingWriteRatio,
        employeeTimeTrackingReadSamplingRatio: samplingConfig.employeeTimeTrackingReadRatio,
        dataRetentionWriteSamplingRatio: samplingConfig.dataRetentionWriteRatio,
        dataRetentionReadSamplingRatio: samplingConfig.dataRetentionReadRatio,
      },
      "OpenTelemetry tracing initialized",
    );

    return {
      enabled: true,
      shutdown: async () => {
        try {
          await sdk?.shutdown();
        } catch (error) {
          logger.warn(
            {
              errorName: error instanceof Error ? error.name : "UnknownError",
              errorMessage: error instanceof Error ? error.message : String(error),
            },
            "OpenTelemetry tracing shutdown failed",
          );
        }
      },
    };
  } catch (error) {
    logger.warn(
      {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
      },
      "OpenTelemetry tracing initialization failed",
    );

    return {
      enabled: false,
      shutdown: async () => undefined,
    };
  }
};
