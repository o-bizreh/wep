export type OptimizationType =
  | 'right-size-ecs'
  | 'right-size-lambda'
  | 'reserved-instance'
  | 'unused-resource'
  | 'over-provisioned-dynamodb'
  | 'stale-s3'
  | 'idle-nat-gateway';

export type RecommendationStatus = 'open' | 'accepted' | 'dismissed' | 'implemented';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface OptimizationRecommendation {
  recommendationId: string;
  serviceId: string;
  type: OptimizationType;
  currentConfiguration: string;
  recommendedConfiguration: string;
  estimatedMonthlySaving: number;
  confidence: ConfidenceLevel;
  evidence: string;
  status: RecommendationStatus;
  implementedAt: string | null;
  actualSaving: number | null;
}
