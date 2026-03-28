import React from "react";
import { Link } from "react-router-dom";
import {
  Coffee,
  Heart,
  ExternalLink,
  Fish,
  Anchor,
  Sparkles,
  Github,
  Mail,
  Lightbulb,
  Zap,
  BarChart3,
  Lock,
  CheckCircle,
  Users,
} from "lucide-react";

const About = () => {
  return (
    <div className="max-w-4xl mx-auto px-4">
      {/* Hero Section */}
      <div className="text-center mb-16">
        <div className="inline-flex items-center justify-center mb-6">
          <div className="bg-teal p-4 rounded-full">
            <Fish className="h-12 w-12 text-white" />
          </div>
        </div>
        <h1 className="font-heading text-3xl md:text-4xl font-bold text-navy dark:text-text-primary tracking-tight mb-4">
          About Fish Cost Calculator
        </h1>
        <p className="text-text-secondary text-lg max-w-2xl mx-auto">
          A yield calculator built by and for the fishing community
        </p>
      </div>

      {/* How It Works Section (from Home) */}
      <div className="mb-12">
        <div className="text-center mb-10">
          <h2 className="font-heading text-2xl md:text-3xl font-semibold text-navy dark:text-text-primary tracking-tight mb-3">
            How It Works
          </h2>
          <p className="text-text-secondary">
            Three simple steps to find your true price
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          <div className="bg-surface-elevated border border-border rounded-xl p-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-teal rounded-full mb-4">
              <span className="text-xl font-bold text-white">1</span>
            </div>
            <h3 className="font-heading text-lg font-semibold text-navy dark:text-text-primary mb-2">
              Select Species
            </h3>
            <p className="text-text-secondary text-sm">
              Choose from 60+ species with research-backed yield data, or upload your own
            </p>
          </div>

          <div className="bg-surface-elevated border border-border rounded-xl p-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-teal rounded-full mb-4">
              <span className="text-xl font-bold text-white">2</span>
            </div>
            <h3 className="font-heading text-lg font-semibold text-navy dark:text-text-primary mb-2">
              Set Conversion
            </h3>
            <p className="text-text-secondary text-sm">
              Input your starting weight, target product form, and processing costs
            </p>
          </div>

          <div className="bg-surface-elevated border border-border rounded-xl p-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-teal rounded-full mb-4">
              <span className="text-xl font-bold text-white">3</span>
            </div>
            <h3 className="font-heading text-lg font-semibold text-navy dark:text-text-primary mb-2">
              Get Your Price
            </h3>
            <p className="text-text-secondary text-sm">
              See your cost breakdown and save calculations for future reference
            </p>
          </div>
        </div>
      </div>

      {/* Origin Story Card */}
      <div className="mb-12">
        <div className="bg-surface-elevated border border-border rounded-xl p-8 md:p-10">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-teal p-2 rounded-lg">
              <Anchor className="h-6 w-6 text-white" />
            </div>
            <h2 className="font-heading text-2xl font-semibold text-navy dark:text-text-primary">
              The Origin Story
            </h2>
          </div>

          <div className="space-y-4 text-text-secondary leading-relaxed">
            <p>
              Fish Cost Calculator grew out of conversations within the{" "}
              <span className="text-teal font-medium">Local Catch Network</span>
              —a vibrant community of fishers, community-supported fisheries (CSFs), and seafood businesses dedicated to sustainable, community-based fishing.
            </p>
            <p>
              Through discussions on the LocalCatch listserv, fishers consistently shared the same challenge: calculating fair prices for processed products. How do you set a price when you're selling skinless fillets instead of whole fish? The question exposed a need for transparency and reliable data about processing yields.
            </p>
            <p>
              Fish Cost Calculator was built to answer that need. We combined research-backed data (from the MAB-37 publication) with an intuitive calculator that empowers the fishing community to make informed pricing decisions. This tool belongs to you—the fishers, processors, and community members who inspired it.
            </p>
          </div>

          {/* Catch Network Link */}
          <div className="mt-8 bg-surface border border-border rounded-lg p-4">
            <div className="flex items-start gap-4">
              <div className="bg-teal p-2 rounded-lg shrink-0">
                <ExternalLink className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="font-medium text-navy dark:text-text-primary mb-1">
                  Join the Local Catch Network
                </h3>
                <p className="text-sm text-text-secondary mb-3">
                  Connect with fishers, CSFs, and seafood businesses committed to sustainability and community-based fishing.
                </p>
                <a
                  href="https://localcatch.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-teal hover:text-[#12A08C] transition-colors text-sm font-medium"
                >
                  Visit Local Catch Network
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Why This Matters Section */}
      <div className="mb-12">
        <div className="bg-surface-elevated border border-border rounded-xl p-8 md:p-10">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-teal p-2 rounded-lg">
              <Lightbulb className="h-6 w-6 text-white" />
            </div>
            <h2 className="font-heading text-2xl font-semibold text-navy dark:text-text-primary">
              Why This Matters
            </h2>
          </div>

          <div className="space-y-4 text-text-secondary leading-relaxed">
            <p>
              Fishers know their craft. But pricing processed products often requires guesswork about yield percentages—and that guesswork can mean the difference between profit and loss.
            </p>
            <p>
              When you sell to a processor, they understand what a "skinless fillet" yield means. But when you sell direct—to restaurants, retailers, or consumers—you need to know: <span className="text-teal font-medium">How much finished product will I actually get from my raw catch?</span>
            </p>
            <p>
              Fish Cost Calculator removes the guesswork. Backed by peer-reviewed research data, this tool makes yield calculations simple, transparent, and accurate. Now you can confidently set prices that reflect your true costs and the value of your work.
            </p>
          </div>
        </div>
      </div>

      {/* Key Features Section (from Home) */}
      <div className="mb-12">
        <div className="text-center mb-10">
          <h2 className="font-heading text-2xl md:text-3xl font-semibold text-navy dark:text-text-primary tracking-tight mb-3">
            Built for Your Reality
          </h2>
          <p className="text-text-secondary">
            Everything you need to price your catch fairly
          </p>
        </div>

        <div className="divide-y divide-border border-t border-border">
          <div className="flex items-start gap-4 py-6">
            <div className="bg-teal p-3 rounded-lg shrink-0">
              <BarChart3 className="h-6 w-6 text-white" />
            </div>
            <div>
              <h3 className="font-heading text-lg font-semibold text-navy dark:text-text-primary mb-1">
                Research-Backed Data
              </h3>
              <p className="text-text-secondary text-sm">
                60+ species with conversion yields from the MAB-37 scientific publication. Built on real fishery research, not guesswork.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 py-6">
            <div className="bg-teal p-3 rounded-lg shrink-0">
              <Zap className="h-6 w-6 text-white" />
            </div>
            <div>
              <h3 className="font-heading text-lg font-semibold text-navy dark:text-text-primary mb-1">
                Custom Species Support
              </h3>
              <p className="text-text-secondary text-sm">
                Upload your own conversion yields and processing costs. Make the calculator work for your unique species and methods.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 py-6">
            <div className="bg-teal p-3 rounded-lg shrink-0">
              <CheckCircle className="h-6 w-6 text-white" />
            </div>
            <div>
              <h3 className="font-heading text-lg font-semibold text-navy dark:text-text-primary mb-1">
                Complete Cost Breakdown
              </h3>
              <p className="text-text-secondary text-sm">
                Factor in labor, cold storage, shipping, and other processing costs. See exactly where your money goes.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-4 py-6">
            <div className="bg-teal p-3 rounded-lg shrink-0">
              <Lock className="h-6 w-6 text-white" />
            </div>
            <div>
              <h3 className="font-heading text-lg font-semibold text-navy dark:text-text-primary mb-1">
                Free & Open Source
              </h3>
              <p className="text-text-secondary text-sm">
                Built for the fishing community. No paywalls, no ads, no corporate motives. Always yours to use and improve.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Open Source & Contribution Section */}
      <div className="mb-12">
        <div className="bg-surface-elevated border border-border rounded-xl p-8 md:p-10">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-teal p-2 rounded-lg">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <h2 className="font-heading text-2xl font-semibold text-navy dark:text-text-primary">
              Built by the Community, for the Community
            </h2>
          </div>

          <div className="text-text-secondary leading-relaxed mb-8">
            <p>
              Fish Cost Calculator is{" "}
              <span className="text-teal font-medium">
                free and open source
              </span>
              . We believe tools for the fishing community should be accessible to everyone, without barriers.
            </p>
          </div>

          <div className="mb-8">
            <h3 className="font-semibold text-navy dark:text-text-primary mb-4">We need your help to grow this tool:</h3>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-teal/10 dark:bg-teal/20 text-teal flex-shrink-0 font-medium">+</span>
                <span><span className="font-medium text-navy dark:text-text-primary">Add species yield data</span> — Know yields we're missing? Submit research or data from your experience.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-teal/10 dark:bg-teal/20 text-teal flex-shrink-0 font-medium">+</span>
                <span><span className="font-medium text-navy dark:text-text-primary">Report bugs and suggest features</span> — Found an issue or have an idea? We want to hear it.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-teal/10 dark:bg-teal/20 text-teal flex-shrink-0 font-medium">+</span>
                <span><span className="font-medium text-navy dark:text-text-primary">Contribute code</span> — Developers, designers, and documentation writers are welcome.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-teal/10 dark:bg-teal/20 text-teal flex-shrink-0 font-medium">+</span>
                <span><span className="font-medium text-navy dark:text-text-primary">Build companion tools</span> — Inventory management? Bills tracker? Let's build it together.</span>
              </li>
            </ul>
          </div>

          <a
            href="https://github.com/paccloud/Fish_Cost_Calculator"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-surface border border-border hover:bg-border/50 text-navy dark:text-text-primary px-4 py-2 rounded-lg transition-colors"
          >
            <Github className="h-5 w-5" />
            View on GitHub
          </a>
        </div>
      </div>

      {/* What's Coming Section (from Home) */}
      <div className="mb-12">
        <div className="bg-surface-elevated border border-border rounded-xl p-8 md:p-10">
          <div className="flex items-center gap-3 mb-6">
            <div className="bg-teal p-2 rounded-lg">
              <Zap className="h-6 w-6 text-white" />
            </div>
            <h2 className="font-heading text-2xl font-semibold text-navy dark:text-text-primary">
              What's Coming
            </h2>
          </div>

          <div className="text-text-secondary leading-relaxed mb-8">
            <p className="mb-6">
              We're planning new tools to support the full fishing business lifecycle:
            </p>
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <span className="text-teal font-bold">→</span>
                <span><span className="font-medium text-navy dark:text-text-primary">Inventory Management</span> — Track what you catch, what you've processed, and what's ready to sell.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-teal font-bold">→</span>
                <span><span className="font-medium text-navy dark:text-text-primary">Bills & Regulations Tracker</span> — Stay on top of fishing regulations, seasonal closures, and legislative changes that affect you.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-teal font-bold">→</span>
                <span><span className="font-medium text-navy dark:text-text-primary">Action Reminders</span> — Get timely alerts for seasonal deadlines, permit renewals, and fishing season dates.</span>
              </li>
            </ul>
          </div>

          <p className="text-teal font-medium">
            What tools would you like to see? Tell us.
          </p>
        </div>
      </div>

      {/* Support Section - Buy Me a Coffee */}
      <div className="mb-12">
        <div className="bg-surface-elevated border border-border rounded-xl p-8 md:p-10 text-center">
          <div className="inline-flex items-center justify-center mb-6">
            <div className="bg-rust p-3 rounded-full">
              <Coffee className="h-8 w-8 text-white" />
            </div>
          </div>

          <h2 className="font-heading text-2xl font-semibold text-navy dark:text-text-primary mb-4">
            Support Fish Cost Calculator
          </h2>

          <p className="text-text-secondary max-w-lg mx-auto mb-8 leading-relaxed">
            If you find Fish Cost Calculator helpful, consider supporting continued development. Your contribution helps fund new features, better data, and keeping this tool free for everyone.
          </p>

          <a
            href="https://buymeacoffee.com/pcswny"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-3 bg-rust hover:bg-[#B8532A] dark:hover:bg-[#F07D4A] text-white font-semibold px-8 py-4 rounded-lg transition-colors active:scale-[0.98]"
          >
            <Coffee className="h-5 w-5" />
            Buy Me a Coffee
            <Heart className="h-4 w-4 text-red-200" />
          </a>

          <p className="text-sm text-text-secondary mt-6 flex items-center justify-center gap-2">
            Thank you for supporting community tools!
          </p>
        </div>
      </div>

      {/* Contact Section */}
      <div className="mb-12">
        <div className="bg-surface-elevated border border-border rounded-xl p-8 md:p-10 text-center">
          <div className="inline-flex items-center justify-center mb-6">
            <div className="bg-teal p-3 rounded-full">
              <Mail className="h-8 w-8 text-white" />
            </div>
          </div>

          <h2 className="font-heading text-2xl font-semibold text-navy dark:text-text-primary mb-4">Get in Touch</h2>

          <p className="text-text-secondary max-w-lg mx-auto mb-6 leading-relaxed">
            Have questions, ideas, or want to contribute to Fish Cost Calculator? We'd love to hear from you!
          </p>

          <a
            href="mailto:ryan@ryan-h.org"
            className="inline-flex items-center gap-3 bg-teal hover:bg-[#0B6958] text-white font-semibold px-6 py-3 rounded-lg transition-colors"
          >
            <Mail className="h-5 w-5" />
            ryan@ryan-h.org
          </a>
        </div>
      </div>

      {/* About the Creator */}
      <div className="mb-12">
        <div className="bg-surface-elevated border border-border rounded-xl p-8 md:p-10">
          <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 items-start">
            <img
              src="https://www.namanet.org/wp-content/uploads/inline-images/ryan_jig-Fish-750x750.jpg"
              alt="Ryan Horwath"
              className="rounded-xl border border-border w-full md:w-[200px] h-auto object-cover"
            />
            <div>
              <h2 className="font-heading text-xl font-bold text-navy dark:text-text-primary mb-1">
                Ryan Horwath
              </h2>
              <p className="text-text-secondary text-sm mb-4">
                NAMA Board Member &middot; Pacific Cloud Seafood &middot; Kodiak, AK
              </p>
              <p className="text-text-secondary leading-relaxed mb-4">
                Ryan owns and operates Pacific Cloud Seafood out of Kodiak, Alaska, where he's been commercial fishing since 2003. After years of struggling with the challenges of running a solo small seafood business — from pricing to processing to logistics — he taught himself to code and built Fish Cost Calculator to solve the pricing transparency problem he and fellow fishers kept running into.
              </p>
              <div className="flex flex-wrap gap-3">
                <a
                  href="https://pacificcloudseafoods.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-teal hover:text-[#12A08C] text-sm font-medium transition-colors"
                >
                  <Fish className="h-4 w-4" />
                  Pacific Cloud Seafood
                </a>
                <a
                  href="https://ryan-h.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-teal hover:text-[#12A08C] text-sm font-medium transition-colors"
                >
                  <ExternalLink className="h-4 w-4" />
                  ryan-h.org
                </a>
                <a
                  href="mailto:ryan@ryan-h.org"
                  className="inline-flex items-center gap-1.5 text-teal hover:text-[#12A08C] text-sm font-medium transition-colors"
                >
                  <Mail className="h-4 w-4" />
                  ryan@ryan-h.org
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Note */}
      <div className="text-center mt-16 py-8 border-t border-border">
        <p className="text-text-secondary text-sm">
          Built with love for the fishing community
        </p>
      </div>
    </div>
  );
};

export default About;
