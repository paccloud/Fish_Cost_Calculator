import React, { useState, useEffect } from "react";
import {
  Sparkles,
  Mail,
  FileDown,
  Clock,
  Bookmark,
  TrendingUp,
  ThumbsUp,
  Send,
  CheckCircle2,
  Loader2,
  ChevronUp,
  Lightbulb,
  Target,
  Zap,
} from "lucide-react";

const INITIAL_FEATURES = [
  {
    id: "email-export",
    title: "Export to Email",
    description: "Send calculation results directly to your email or share with buyers via email",
    icon: Mail,
    status: "upcoming",
    votes: 0,
    category: "Export",
  },
  {
    id: "instant-quotes",
    title: "Instant Quotes for Buyers",
    description: "Generate professional quotes instantly for your buyers with detailed cost breakdowns",
    icon: FileDown,
    status: "upcoming",
    votes: 0,
    category: "Business",
  },
  {
    id: "saved-products",
    title: "Saved Frequently Used Products/Forms",
    description: "Save your most commonly used products and form configurations for quick access",
    icon: Bookmark,
    status: "upcoming",
    votes: 0,
    category: "Productivity",
  },
  {
    id: "economy-scale",
    title: "Economy of Scale Pricing",
    description: "Automatic quantity price breaks per unit - the more you process, the lower the per-unit cost",
    icon: TrendingUp,
    status: "upcoming",
    votes: 0,
    category: "Pricing",
  },
];

const FeatureCard = ({ feature, onVote, hasVoted }) => {
  const IconComponent = feature.icon;

  const statusColors = {
    upcoming: "bg-teal",
    "in-progress": "bg-rust",
    completed: "bg-[#16A34A]",
  };

  const statusLabels = {
    upcoming: "Upcoming",
    "in-progress": "In Progress",
    completed: "Completed",
  };

  return (
    <div className="relative group">
      <div className="bg-surface-elevated border border-border rounded-xl p-6 h-full flex flex-col">
        <div className="flex items-start justify-between mb-4">
          <div className={`${statusColors[feature.status]} p-3 rounded-lg`}>
            <IconComponent className="h-6 w-6 text-white" />
          </div>
          <span className={`text-xs font-medium px-3 py-1 rounded-full ${statusColors[feature.status]} text-white`}>
            {statusLabels[feature.status]}
          </span>
        </div>

        <h3 className="font-heading text-lg font-semibold text-navy dark:text-text-primary mb-2">
          {feature.title}
        </h3>
        <p className="text-text-secondary text-sm flex-grow mb-4">
          {feature.description}
        </p>

        <div className="flex items-center justify-between pt-4 border-t border-border">
          <span className="text-xs bg-surface text-text-secondary px-2 py-1 rounded">
            {feature.category}
          </span>
          <button
            onClick={() => onVote(feature.id)}
            disabled={hasVoted}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-300 ${
              hasVoted
                ? "bg-teal/10 text-teal cursor-default"
                : "bg-surface hover:bg-teal/10 text-text-secondary hover:text-teal"
            }`}
          >
            {hasVoted ? (
              <CheckCircle2 size={18} />
            ) : (
              <ChevronUp size={18} />
            )}
            <span className="font-medium">{feature.votes}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const FeaturesRoadmap = () => {
  const [features, setFeatures] = useState(() => {
    const saved = localStorage.getItem("roadmapFeatures");
    if (saved) {
      const parsed = JSON.parse(saved);
      // Merge saved votes with initial features
      return INITIAL_FEATURES.map(feature => ({
        ...feature,
        votes: parsed.find(f => f.id === feature.id)?.votes || feature.votes,
      })).concat(
        parsed.filter(f => !INITIAL_FEATURES.find(initial => initial.id === f.id))
      );
    }
    return INITIAL_FEATURES;
  });

  const [votedFeatures, setVotedFeatures] = useState(() => {
    const saved = localStorage.getItem("votedFeatures");
    return saved ? JSON.parse(saved) : [];
  });

  const [newRequest, setNewRequest] = useState("");
  const [requestSubmitted, setRequestSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    localStorage.setItem("roadmapFeatures", JSON.stringify(features));
  }, [features]);

  useEffect(() => {
    localStorage.setItem("votedFeatures", JSON.stringify(votedFeatures));
  }, [votedFeatures]);

  const handleVote = (featureId) => {
    if (votedFeatures.includes(featureId)) return;

    setFeatures(prev =>
      prev.map(feature =>
        feature.id === featureId
          ? { ...feature, votes: feature.votes + 1 }
          : feature
      )
    );
    setVotedFeatures(prev => [...prev, featureId]);
  };

  const handleSubmitRequest = async (e) => {
    e.preventDefault();
    if (!newRequest.trim()) return;

    setIsSubmitting(true);

    // Simulate submission delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Add as a new feature request with unique id
    const newFeature = {
      id: `request-${Date.now()}`,
      title: newRequest.trim(),
      description: "Community suggested feature",
      icon: Lightbulb,
      status: "upcoming",
      votes: 1,
      category: "Community Request",
    };

    setFeatures(prev => [...prev, newFeature]);
    setVotedFeatures(prev => [...prev, newFeature.id]);
    setNewRequest("");
    setIsSubmitting(false);
    setRequestSubmitted(true);

    setTimeout(() => setRequestSubmitted(false), 3000);
  };

  // Sort features by votes (descending)
  const sortedFeatures = [...features].sort((a, b) => b.votes - a.votes);

  return (
    <div className="max-w-6xl mx-auto px-4">
      {/* Hero Section */}
      <div className="text-center mb-16">
        <div className="inline-flex items-center justify-center mb-6">
          <div className="bg-teal p-4 rounded-full">
            <Target className="h-12 w-12 text-white" />
          </div>
        </div>
        <h1 className="font-heading text-3xl md:text-4xl font-bold text-navy dark:text-text-primary tracking-tight mb-4">
          Features Roadmap
        </h1>
        <p className="text-xl text-text-secondary max-w-2xl mx-auto">
          Help shape the future of Fish Cost Calculator. Vote on upcoming features or suggest your own!
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
        <div className="bg-surface-elevated border border-border rounded-xl p-4 text-center">
          <Zap className="h-6 w-6 text-amber-500 mx-auto mb-2" />
          <p className="text-2xl font-bold text-navy dark:text-text-primary">{features.length}</p>
          <p className="text-sm text-text-secondary">Total Features</p>
        </div>
        <div className="bg-surface-elevated border border-border rounded-xl p-4 text-center">
          <Clock className="h-6 w-6 text-teal mx-auto mb-2" />
          <p className="text-2xl font-bold text-navy dark:text-text-primary">
            {features.filter(f => f.status === "upcoming").length}
          </p>
          <p className="text-sm text-text-secondary">Upcoming</p>
        </div>
        <div className="bg-surface-elevated border border-border rounded-xl p-4 text-center">
          <Loader2 className="h-6 w-6 text-rust mx-auto mb-2" />
          <p className="text-2xl font-bold text-navy dark:text-text-primary">
            {features.filter(f => f.status === "in-progress").length}
          </p>
          <p className="text-sm text-text-secondary">In Progress</p>
        </div>
        <div className="bg-surface-elevated border border-border rounded-xl p-4 text-center">
          <CheckCircle2 className="h-6 w-6 text-[#16A34A] mx-auto mb-2" />
          <p className="text-2xl font-bold text-navy dark:text-text-primary">
            {features.filter(f => f.status === "completed").length}
          </p>
          <p className="text-sm text-text-secondary">Completed</p>
        </div>
      </div>

      {/* Submit Request Form */}
      <div className="mb-12">
        <div className="bg-surface-elevated border border-border rounded-xl p-8">
          <div className="flex items-center gap-3 mb-6">
            <Lightbulb className="h-6 w-6 text-teal" />
            <h2 className="font-heading text-2xl font-semibold text-navy dark:text-text-primary">
              Suggest a Feature
            </h2>
          </div>

          <form onSubmit={handleSubmitRequest} className="space-y-4">
            <div>
              <input
                type="text"
                value={newRequest}
                onChange={(e) => setNewRequest(e.target.value)}
                placeholder="What feature would help you most?"
                className="w-full bg-surface border border-border rounded-lg p-4 focus:ring-2 focus:ring-teal outline-none text-navy dark:text-text-primary placeholder:text-text-secondary"
                maxLength={200}
              />
              <p className="mt-2 text-xs text-text-secondary text-right">
                {newRequest.length}/200 characters
              </p>
            </div>

            <button
              type="submit"
              disabled={!newRequest.trim() || isSubmitting}
              className="w-full md:w-auto flex items-center justify-center gap-3 bg-rust hover:bg-[#B8532A] dark:hover:bg-[#F07D4A] disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold px-8 py-4 rounded-lg transition-all duration-300 active:scale-[0.98]"
            >
              {isSubmitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
              {isSubmitting ? "Submitting..." : "Submit Request"}
            </button>
          </form>

          {requestSubmitted && (
            <div className="mt-4 p-4 bg-teal/10 border border-teal/30 rounded-xl flex items-center gap-3 animate-fade-in">
              <CheckCircle2 className="h-5 w-5 text-teal" />
              <p className="text-teal">
                Thank you! Your feature request has been submitted.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Features Grid */}
      <div className="mb-8">
        <h2 className="font-heading text-2xl font-semibold text-navy dark:text-text-primary mb-6 flex items-center gap-3">
          <Sparkles className="h-6 w-6 text-teal" />
          Upcoming Features
          <span className="text-sm font-normal text-text-secondary">
            (sorted by votes)
          </span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {sortedFeatures.map((feature) => (
            <FeatureCard
              key={feature.id}
              feature={feature}
              onVote={handleVote}
              hasVoted={votedFeatures.includes(feature.id)}
            />
          ))}
        </div>
      </div>

      {/* Info Note */}
      <div className="text-center py-8 border-t border-border">
        <p className="text-text-secondary text-sm flex items-center justify-center gap-2">
          <ThumbsUp className="h-4 w-4" />
          Your votes help us prioritize development!
        </p>
      </div>
    </div>
  );
};

export default FeaturesRoadmap;
