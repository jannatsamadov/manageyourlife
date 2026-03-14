import ChronosTimer from "@/components/strategy/ChronosTimer";
import AttributeBars from "@/components/strategy/AttributeBars";
import VisionPipeline from "@/components/strategy/VisionPipeline";
import LifeOps from "@/components/strategy/LifeOps";

export default function Strategy() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 animate-fade-in">
      {/* Top Panel: Chronos + Attributes */}
      <div className="space-y-4">
        <ChronosTimer />
        <AttributeBars />
      </div>

      {/* Main: Vision Pipelines */}
      <VisionPipeline />

      {/* Life Ops */}
      <LifeOps />
    </div>
  );
}
