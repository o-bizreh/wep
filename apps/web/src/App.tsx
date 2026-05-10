import { Routes, Route, Navigate } from 'react-router-dom';
import { DashboardShell } from '@wep/ui';
import { ServicesProvider } from './lib/ServicesContext';
import { AwsIdentityBadge } from './components/AwsIdentityBadge';
import { OnboardingGate } from './components/Onboarding';
import { CredentialsExpiredBanner } from './components/CredentialsExpiredBanner';
import { HubPage } from './pages/hub/PlatformHubPage';
import { CatalogPage } from './pages/catalog/CatalogPage';
import { ServiceDetailPage } from './pages/catalog/ServiceDetailPage';
import { TeamDashboardPage } from './pages/catalog/TeamDashboardPage';
import { StaleServicesPage } from './pages/catalog/StaleServicesPage';
import { TechRadarPage } from './pages/catalog/TechRadarPage';
import { DeploymentFeedPage } from './pages/deployments/DeploymentFeedPage';
import { PromotionTrackerPage } from './pages/deployments/PromotionTrackerPage';
import { EnvironmentComparePage } from './pages/deployments/EnvironmentComparePage';
import { ServiceDeploymentHistoryPage } from './pages/deployments/ServiceDeploymentHistoryPage';
import { VelocityDashboardPage } from './pages/velocity/VelocityDashboardPage';
import { ProjectHealthPage } from './pages/measure/ProjectHealthPage';
import { SprintDigestPage } from './pages/measure/SprintDigestPage';
import { QualityTrendPage } from './pages/measure/QualityTrendPage';
import { TeamVelocityPage } from './pages/velocity/TeamVelocityPage';
import { PipelineHealthPage } from './pages/pipelines/PipelineHealthPage';
import { CostOverviewPage } from './pages/costs/CostOverviewPage';
import { PortalHomePage } from './pages/portal/PortalHomePage';
import { PortalRequestPage } from './pages/portal/PortalRequestPage';
import { PortalRequestsPage } from './pages/portal/PortalRequestsPage';
import { PortalRequestDetailPage } from './pages/portal/PortalRequestDetailPage';
import { PortalApprovePage } from './pages/portal/PortalApprovePage';
import { PortalOperationsManagePage } from './pages/portal/PortalOperationsManagePage';
import { PortalOperationFormPage } from './pages/portal/PortalOperationFormPage';
import { RunbookDashboardPage } from './pages/portal/RunbookDashboardPage';
import { RunbookStudioPage } from './pages/portal/RunbookStudioPage';
import { JitResourcesPage } from './pages/portal/JitResourcesPage';
import { JitSessionsPage } from './pages/portal/JitSessionsPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { TeamsSettingsPage } from './pages/settings/TeamsSettingsPage';
import { SecurityFeedPage } from './pages/security/SecurityFeedPage';
import { SecurityReposPage } from './pages/security/SecurityReposPage';
import { GitLeaksPage } from './pages/security/GitLeaksPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { ErrorsPage } from './pages/errors/ErrorsPage';
import { AnnouncementsPage } from './pages/announcements/AnnouncementsPage';
import { InfraResourcesPage } from './pages/infra/InfraResourcesPage';
import { VpcTopologyPage } from './pages/infra/VpcTopologyPage';
import { DistributionsPage } from './pages/global/DistributionsPage';
import { DnsPage } from './pages/global/DnsPage';
import { CertificatesPage } from './pages/global/CertificatesPage';
import { WafPage } from './pages/global/WafPage';
import { RunbookAssistantPage } from './pages/ai/RunbookAssistantPage';
import { DeploymentDigestPage } from './pages/ai/DeploymentDigestPage';
import { CostAnomalyExplainerPage } from './pages/ai/CostAnomalyExplainerPage';
import { CveTriagePage } from './pages/ai/CveTriagePage';
import { IncidentScribePage } from './pages/ai/IncidentScribePage';
import { CampaignImpactPage } from './pages/ai/CampaignImpactPage';
import { InfraSimulatorPage } from './pages/ai/InfraSimulatorPage';
import { DeploymentRiskPage } from './pages/ai/DeploymentRiskPage';
import { CampaignApprovalPage } from './pages/ai/CampaignApprovalPage';
import { DependencyMapPage } from './pages/portfolio/DependencyMapPage';
import { CouplingDetectorPage } from './pages/portfolio/CouplingDetectorPage';
import { RecommendationsPage } from './pages/portfolio/RecommendationsPage';
import { CostComparisonPage } from './pages/portfolio/CostComparisonPage';
import { ExecutiveSummaryPage } from './pages/portfolio/ExecutiveSummaryPage';
import { BudgetsPage } from './pages/portfolio/BudgetsPage';

export function App() {
  return (
    <ServicesProvider>
      <OnboardingGate />
      <CredentialsExpiredBanner />
      <Routes>
        {/* Standalone Home Page (Workbench Selector) */}
        <Route path="/" element={<HubPage />} />

        {/* Operational Workbench (Wrapped in Shell) */}
        <Route
          path="/*"
          element={
            <DashboardShell headerRight={<AwsIdentityBadge />}>
              <Routes>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/errors" element={<ErrorsPage />} />
                <Route path="/announcements" element={<AnnouncementsPage />} />
                <Route path="/catalog" element={<CatalogPage />} />
                <Route path="/catalog/stale" element={<StaleServicesPage />} />
                <Route path="/catalog/radar" element={<TechRadarPage />} />
                <Route path="/catalog/services/:serviceId" element={<ServiceDetailPage />} />
                <Route path="/catalog/teams/:teamId" element={<TeamDashboardPage />} />
                <Route path="/deployments" element={<DeploymentFeedPage />} />
                <Route path="/deployments/promotion" element={<PromotionTrackerPage />} />
                <Route path="/deployments/compare" element={<EnvironmentComparePage />} />
                <Route path="/deployments/services/:serviceId" element={<ServiceDeploymentHistoryPage />} />
                <Route path="/velocity" element={<VelocityDashboardPage />} />
                <Route path="/measure/health" element={<ProjectHealthPage />} />
                <Route path="/measure/sprint" element={<SprintDigestPage />} />
                <Route path="/measure/quality" element={<QualityTrendPage />} />
                <Route path="/velocity/teams/:teamId" element={<TeamVelocityPage />} />
                <Route path="/pipelines" element={<PipelineHealthPage />} />
                <Route path="/costs" element={<CostOverviewPage />} />
                <Route path="/costs/executive" element={<ExecutiveSummaryPage />} />
                <Route path="/costs/comparison" element={<CostComparisonPage />} />
                <Route path="/costs/recommendations" element={<RecommendationsPage />} />
                <Route path="/costs/budgets" element={<BudgetsPage />} />
                <Route path="/catalog/dependencies" element={<DependencyMapPage />} />
                <Route path="/catalog/coupling" element={<CouplingDetectorPage />} />
                <Route path="/portal" element={<PortalHomePage />} />
                <Route path="/portal/request/:operationId" element={<PortalRequestPage />} />
                <Route path="/portal/operations/manage" element={<PortalOperationsManagePage />} />
                <Route path="/portal/operations/new" element={<PortalOperationFormPage />} />
                <Route path="/portal/operations/:operationId/edit" element={<PortalOperationFormPage />} />
                <Route path="/portal/runbooks" element={<RunbookDashboardPage />} />
                <Route path="/portal/runbooks/new" element={<RunbookStudioPage />} />
                <Route path="/portal/runbooks/:id/edit" element={<RunbookStudioPage />} />
                <Route path="/portal/runbooks/:id" element={<RunbookStudioPage />} />
                <Route path="/portal/approve/:requestId" element={<PortalApprovePage />} />
                <Route path="/portal/requests/:requestId" element={<PortalRequestDetailPage />} />
                <Route path="/portal/requests" element={<PortalRequestsPage />} />
                <Route path="/portal/jit-resources" element={<JitResourcesPage />} />
                <Route path="/portal/jit-sessions" element={<JitSessionsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/settings/teams" element={<TeamsSettingsPage />} />
                <Route path="/security" element={<SecurityFeedPage />} />
                <Route path="/security/repos" element={<SecurityReposPage />} />
                <Route path="/security/gitleaks" element={<GitLeaksPage />} />
                <Route path="/infra/resources" element={<InfraResourcesPage />} />
                <Route path="/infra/topology" element={<VpcTopologyPage />} />
                <Route path="/global/distributions" element={<DistributionsPage />} />
                <Route path="/global/dns"           element={<DnsPage />} />
                <Route path="/global/certificates"  element={<CertificatesPage />} />
                <Route path="/global/waf"           element={<WafPage />} />
                <Route path="/ai/runbook"            element={<RunbookAssistantPage />} />
                <Route path="/ai/digest"             element={<DeploymentDigestPage />} />
                <Route path="/ai/cost-explain"       element={<CostAnomalyExplainerPage />} />
                <Route path="/ai/cve-triage"         element={<CveTriagePage />} />
                <Route path="/ai/incident"           element={<IncidentScribePage />} />
                <Route path="/ai/campaign-impact"    element={<CampaignImpactPage />} />
                <Route path="/ai/infra-simulate"     element={<InfraSimulatorPage />} />
                <Route path="/ai/deployment-risk"    element={<DeploymentRiskPage />} />
                <Route path="/ai/campaign-impact/approve/:approvalId" element={<CampaignApprovalPage />} />
              </Routes>
            </DashboardShell>
          }
        />
      </Routes>
    </ServicesProvider>
  );
}
