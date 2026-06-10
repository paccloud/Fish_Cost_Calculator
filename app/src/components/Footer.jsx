import React from "react";
import { Link } from "react-router-dom";
import { Fish, Github, ExternalLink, Heart } from "lucide-react";

const Footer = () => {
  return (
    <footer className="bg-navy border-t border-white/10 transition-colors">
      {/* Main Footer Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12 mb-12">
          {/* Fish Cost Calculator Column */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="bg-teal p-1.5 rounded-md">
                <Fish className="h-5 w-5 text-white" />
              </div>
              <h3 className="text-lg text-white font-heading font-bold">
                Fish Cost Calculator
              </h3>
            </div>
            <p className="text-white/60 text-sm leading-relaxed">
              Open-source tools for the fishing community
            </p>
            <a
              href="https://localcatch.org"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-teal hover:text-[#12A08C] transition-colors text-sm font-medium"
            >
              Visit localcatch.org
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          {/* Tools Column */}
          <div className="space-y-4">
            <h3 className="text-lg text-white font-heading font-bold">
              Tools
            </h3>
            <ul className="space-y-3">
              <li>
                <Link
                  to="/"
                  className="text-white/60 hover:text-teal transition-colors text-sm"
                >
                  Calculator
                </Link>
              </li>
              <li>
                <Link
                  to="/data-sources"
                  className="text-white/60 hover:text-teal transition-colors text-sm"
                >
                  Data Sources
                </Link>
              </li>
              <li>
                <Link
                  to="/roadmap"
                  className="text-white/60 hover:text-teal transition-colors text-sm"
                >
                  Roadmap
                </Link>
              </li>
            </ul>
          </div>

          {/* Community Column */}
          <div className="space-y-4">
            <h3 className="text-lg text-white font-heading font-bold">
              Community
            </h3>
            <ul className="space-y-3">
              <li>
                <a
                  href="https://github.com/paccloud/Fish_Cost_Calculator"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-white/60 hover:text-teal transition-colors text-sm"
                >
                  <Github className="h-4 w-4" />
                  GitHub
                </a>
              </li>
              <li>
                <Link
                  to="/about"
                  className="text-white/60 hover:text-teal transition-colors text-sm"
                >
                  About
                </Link>
              </li>
              <li>
                <a
                  href="mailto:ryan@pacificcloudseafoods.com"
                  className="inline-flex items-center gap-1 text-white/60 hover:text-teal transition-colors text-sm"
                >
                  Contact
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-white/10 my-8"></div>

        {/* Copyright & Bottom Bar */}
        <div className="flex flex-col md:flex-row items-center justify-between">
          <p className="text-white/40 text-sm text-center md:text-left">
            © 2026 Fish Cost Calculator. Free & open source.
          </p>
          <p className="text-white/30 text-xs mt-4 md:mt-0 flex items-center gap-1">
            Built with <Heart className="h-3.5 w-3.5 text-red-400" /> for the
            fishing community
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
