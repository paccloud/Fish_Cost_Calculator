import React, { useState } from "react";
import {
  MessageSquarePlus,
  Send,
  Bug,
  Lightbulb,
  HelpCircle,
  Fish,
  CheckCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";

const REQUEST_TYPES = [
  {
    id: "feature",
    label: "Feature Request",
    icon: Lightbulb,
    description: "Suggest a new feature or improvement",
    color: "bg-rust",
  },
  {
    id: "bug",
    label: "Bug Report",
    icon: Bug,
    description: "Report an issue or problem",
    color: "bg-[#DC2626]",
  },
  {
    id: "fish-data",
    label: "Fish Data Request",
    icon: Fish,
    description: "Request new fish species or yield data",
    color: "bg-teal",
  },
  {
    id: "question",
    label: "Question / Other",
    icon: HelpCircle,
    description: "General questions or feedback",
    color: "bg-navy",
  },
];

const SubmitRequest = () => {
  const [formData, setFormData] = useState({
    type: "",
    title: "",
    description: "",
    email: "",
    priority: "medium",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null); // 'success' | 'error' | null
  const [errors, setErrors] = useState({});

  const validateForm = () => {
    const newErrors = {};
    if (!formData.type) newErrors.type = "Please select a request type";
    if (!formData.title.trim()) newErrors.title = "Title is required";
    if (!formData.description.trim())
      newErrors.description = "Description is required";
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Please enter a valid email address";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setIsSubmitting(true);
    setSubmitStatus(null);

    try {
      // For now, we'll create a mailto link or use a future API endpoint
      // This could be connected to a backend service, GitHub Issues API, or email service
      const mailtoSubject = encodeURIComponent(
        `[${formData.type.toUpperCase()}] ${formData.title}`
      );
      const mailtoBody = encodeURIComponent(
        `Request Type: ${formData.type}\n` +
          `Priority: ${formData.priority}\n` +
          `Contact Email: ${formData.email || "Not provided"}\n\n` +
          `Description:\n${formData.description}`
      );

      // Open email client
      window.location.href = `mailto:ryan@pacificcloudseafoods.com?subject=${mailtoSubject}&body=${mailtoBody}`;

      // Simulate success state for UI feedback
      await new Promise((resolve) => setTimeout(resolve, 500));
      setSubmitStatus("success");
      setFormData({
        type: "",
        title: "",
        description: "",
        email: "",
        priority: "medium",
      });
    } catch (error) {
      setSubmitStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: null }));
    }
  };

  const selectedType = REQUEST_TYPES.find((t) => t.id === formData.type);

  return (
    <div className="max-w-4xl mx-auto px-4">
      {/* Hero Section */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center justify-center mb-6">
          <div className="bg-teal p-4 rounded-full">
            <MessageSquarePlus className="h-12 w-12 text-white" />
          </div>
        </div>
        <h1 className="font-heading text-3xl md:text-4xl font-bold text-navy dark:text-text-primary tracking-tight mb-4">
          Submit a Request
        </h1>
        <p className="text-xl text-text-secondary max-w-2xl mx-auto">
          Help us improve Fish Cost Calculator! Submit feature requests, report bugs, or
          request new fish data.
        </p>
      </div>

      {/* Success/Error Messages */}
      {submitStatus === "success" && (
        <div className="mb-8 p-4 bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-300 dark:border-emerald-600/30 rounded-xl flex items-center gap-3">
          <CheckCircle className="h-6 w-6 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div>
            <p className="font-medium text-emerald-800 dark:text-emerald-300">
              Request submitted!
            </p>
            <p className="text-sm text-emerald-700 dark:text-emerald-400/80">
              Your email client should have opened with the request details.
              Thank you for your feedback!
            </p>
          </div>
        </div>
      )}

      {submitStatus === "error" && (
        <div className="mb-8 p-4 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-600/30 rounded-xl flex items-center gap-3">
          <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400 shrink-0" />
          <div>
            <p className="font-medium text-red-800 dark:text-red-300">
              Something went wrong
            </p>
            <p className="text-sm text-red-700 dark:text-red-400/80">
              Please try again or contact us directly at
              ryan@pacificcloudseafoods.com
            </p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Request Type Selection */}
        <div className="mb-8">
          <label className="block text-lg font-semibold text-navy dark:text-text-primary mb-4">
            What type of request is this?
            {errors.type && (
              <span className="text-red-500 text-sm font-normal ml-2">
                {errors.type}
              </span>
            )}
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {REQUEST_TYPES.map((type) => {
              const Icon = type.icon;
              const isSelected = formData.type === type.id;
              return (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => handleInputChange("type", type.id)}
                  className={`relative group p-4 rounded-xl border-2 transition-all duration-300 text-left ${
                    isSelected
                      ? "border-transparent " +
                        type.color +
                        " text-white"
                      : "border-border bg-surface-elevated hover:border-teal/50"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`p-2 rounded-lg ${
                        isSelected
                          ? "bg-white/20"
                          : type.color
                      }`}
                    >
                      <Icon
                        className="h-5 w-5 text-white"
                      />
                    </div>
                    <div>
                      <h3
                        className={`font-semibold ${
                          isSelected
                            ? "text-white"
                            : "text-navy dark:text-text-primary"
                        }`}
                      >
                        {type.label}
                      </h3>
                      <p
                        className={`text-sm ${
                          isSelected
                            ? "text-white/80"
                            : "text-text-secondary"
                        }`}
                      >
                        {type.description}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Form Fields */}
        <div className="mb-8">
          <div className="bg-surface-elevated border border-border rounded-xl p-6 md:p-8 space-y-6">
            {/* Title */}
            <div>
              <label
                htmlFor="title"
                className="block text-text-secondary text-sm font-medium mb-2"
              >
                Title *
                {errors.title && (
                  <span className="text-red-500 ml-2">{errors.title}</span>
                )}
              </label>
              <input
                type="text"
                id="title"
                value={formData.title}
                onChange={(e) => handleInputChange("title", e.target.value)}
                placeholder="Brief summary of your request"
                className={`w-full px-4 py-3 bg-surface border rounded-lg text-navy dark:text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-teal transition-all ${
                  errors.title
                    ? "border-red-500"
                    : "border-border"
                }`}
              />
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="description"
                className="block text-text-secondary text-sm font-medium mb-2"
              >
                Description *
                {errors.description && (
                  <span className="text-red-500 ml-2">{errors.description}</span>
                )}
              </label>
              <textarea
                id="description"
                rows={5}
                value={formData.description}
                onChange={(e) =>
                  handleInputChange("description", e.target.value)
                }
                placeholder={
                  formData.type === "bug"
                    ? "Please describe the issue, steps to reproduce, and expected behavior..."
                    : formData.type === "fish-data"
                    ? "What fish species or yield data would you like to see added? Include any sources if available..."
                    : formData.type === "feature"
                    ? "Describe the feature you'd like to see and how it would help you..."
                    : "Tell us more about your question or feedback..."
                }
                className={`w-full px-4 py-3 bg-surface border rounded-lg text-navy dark:text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-teal transition-all resize-none ${
                  errors.description
                    ? "border-red-500"
                    : "border-border"
                }`}
              />
            </div>

            {/* Priority and Email Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Priority */}
              <div>
                <label
                  htmlFor="priority"
                  className="block text-text-secondary text-sm font-medium mb-2"
                >
                  Priority
                </label>
                <select
                  id="priority"
                  value={formData.priority}
                  onChange={(e) => handleInputChange("priority", e.target.value)}
                  className="w-full px-4 py-3 bg-surface border border-border rounded-lg text-navy dark:text-text-primary focus:outline-none focus:ring-2 focus:ring-teal transition-all"
                >
                  <option value="low">Low - Nice to have</option>
                  <option value="medium">Medium - Would be helpful</option>
                  <option value="high">High - Important for my work</option>
                </select>
              </div>

              {/* Email */}
              <div>
                <label
                  htmlFor="email"
                  className="block text-text-secondary text-sm font-medium mb-2"
                >
                  Your Email (optional)
                  {errors.email && (
                    <span className="text-red-500 ml-2">{errors.email}</span>
                  )}
                </label>
                <input
                  type="email"
                  id="email"
                  value={formData.email}
                  onChange={(e) => handleInputChange("email", e.target.value)}
                  placeholder="For follow-up questions"
                  className={`w-full px-4 py-3 bg-surface border rounded-lg text-navy dark:text-text-primary placeholder-text-secondary focus:outline-none focus:ring-2 focus:ring-teal transition-all ${
                    errors.email
                      ? "border-red-500"
                      : "border-border"
                  }`}
                />
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-4">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full md:w-auto inline-flex items-center justify-center gap-3 bg-rust hover:bg-[#B8532A] dark:hover:bg-[#F07D4A] disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-semibold px-8 py-4 rounded-lg transition-all duration-300 active:scale-[0.98]"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send className="h-5 w-5" />
                    Submit Request
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* GitHub Alternative */}
      <div className="text-center mt-8 py-6 border-t border-border">
        <p className="text-text-secondary text-sm mb-3">
          Prefer GitHub? You can also{" "}
          <a
            href="https://github.com/paccloud/Fish_Cost_Calculator/issues/new"
            target="_blank"
            rel="noopener noreferrer"
            className="text-teal hover:text-[#12A08C] font-medium"
          >
            create an issue
          </a>{" "}
          directly on our repository.
        </p>
        <p className="text-text-secondary text-xs">
          Thank you for helping improve Fish Cost Calculator!
        </p>
      </div>
    </div>
  );
};

export default SubmitRequest;
