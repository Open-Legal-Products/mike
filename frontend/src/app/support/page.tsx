"use client";

import { useState, useEffect } from "react";
import { Send, CheckCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/contexts/AuthContext";

type FeedbackType = "bug" | "feature" | "question" | "other";

export default function SupportPage() {
    const router = useRouter();
    const { user, isAuthenticated, authLoading } = useAuth();

    useEffect(() => {
        if (!authLoading && !isAuthenticated) {
            router.push("/");
        }
    }, [authLoading, isAuthenticated, router]);
    const [feedbackType, setFeedbackType] = useState<FeedbackType>("question");
    const [subject, setSubject] = useState("");
    const [message, setMessage] = useState("");
    const [link, setLink] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const feedbackTypes: {
        value: FeedbackType;
        label: string;
        description: string;
    }[] = [
        {
            value: "bug",
            label: "问题反馈",
            description: "报告功能异常或错误",
        },
        {
            value: "feature",
            label: "功能建议",
            description: "提出新功能或改进建议",
        },
        {
            value: "question",
            label: "使用咨询",
            description: "咨询如何使用本产品",
        },
        {
            value: "other",
            label: "其他",
            description: "一般反馈或其他问题",
        },
    ];

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsSubmitting(true);

        try {
            const response = await fetch("/api/support", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    type: feedbackType,
                    subject,
                    message,
                    email: user?.email,
                    link,
                }),
            });

            if (!response.ok) {
                throw new Error("提交反馈失败");
            }

            setIsSubmitted(true);
        } catch (err) {
            console.error("Error submitting feedback:", err);
            setError("提交反馈失败，请重试。");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isSubmitted) {
        return (
            <div className="h-full flex items-center justify-center p-4">
                <div className="max-w-md w-full bg-white rounded-xl text-center">
                    <div className="flex justify-center mb-4">
                        <div className="h-16 w-16 bg-green-100 rounded-full flex items-center justify-center">
                            <CheckCircle className="h-8 w-8 text-green-600" />
                        </div>
                    </div>
                    <h2 className="text-2xl font-semibold text-gray-900 mb-2">
                        感谢您帮助我们改进产品。
                    </h2>
                    <p className="text-gray-600 mb-6">
                        我们会尽快通过邮件与您联系。
                    </p>
                    <button
                        onClick={() => router.push("/")}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
                    >
                        返回首页
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full flex flex-col px-6 h-full">
            <div className="w-full max-w-4xl m-auto flex flex-col h-full">
                {/* Fixed Header Section */}
                <div className="flex-shrink-0 pt-6 md:pt-10 pb-0">
                    <div className="mb-5">
                        <h1 className="text-4xl font-medium font-eb-garamond text-gray-900 mb-3">
                            帮助与支持
                        </h1>
                    </div>
                </div>

                {/* Form Container */}
                <div className="flex-1 overflow-y-auto pb-6">
                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                        <form onSubmit={handleSubmit} className="space-y-6">
                            {/* Feedback Type Selection */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-3">
                                    您需要哪方面的帮助？
                                </label>
                                <div className="grid grid-cols-2 gap-3">
                                    {feedbackTypes.map((type) => (
                                        <button
                                            key={type.value}
                                            type="button"
                                            onClick={() =>
                                                setFeedbackType(type.value)
                                            }
                                            className={`p-4 rounded-lg border-2 text-left transition-all ${
                                                feedbackType === type.value
                                                    ? "border-blue-600 bg-blue-50"
                                                    : "border-gray-200 hover:border-gray-300"
                                            }`}
                                        >
                                            <div
                                                className={`font-medium ${
                                                    feedbackType === type.value
                                                        ? "text-blue-700"
                                                        : "text-gray-900"
                                                }`}
                                            >
                                                {type.label}
                                            </div>
                                            <div className="text-xs text-gray-500 mt-1">
                                                {type.description}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Link (for bugs) */}
                            {feedbackType === "bug" && (
                                <div>
                                    <label
                                        htmlFor="link"
                                        className="block text-sm font-medium text-gray-700 mb-2"
                                    >
                                        问题相关链接（选填）
                                    </label>
                                    <input
                                        type="url"
                                        id="link"
                                        value={link}
                                        onChange={(e) =>
                                            setLink(e.target.value)
                                        }
                                        placeholder="https://mikeoss.com/..."
                                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">
                                        如果问题出现在某次对话中，请将鼠标移到侧边栏中的对话上，点击更多菜单，选择分享，然后将链接粘贴到这里。
                                    </p>
                                </div>
                            )}

                            {/* Subject */}
                            <div>
                                <label
                                    htmlFor="subject"
                                    className="block text-sm font-medium text-gray-700 mb-2"
                                >
                                    主题
                                </label>
                                <input
                                    type="text"
                                    id="subject"
                                    value={subject}
                                    onChange={(e) => setSubject(e.target.value)}
                                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                    required
                                />
                            </div>

                            {/* Message */}
                            <div>
                                <label
                                    htmlFor="message"
                                    className="block text-sm font-medium text-gray-700 mb-2"
                                >
                                    详细说明
                                </label>
                                <textarea
                                    id="message"
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    placeholder="请详细描述您的问题、故障或建议..."
                                    rows={5}
                                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all resize-none"
                                    required
                                />
                            </div>

                            {/* Email Display (if logged in) */}
                            {user?.email && (
                                <div className="text-sm text-gray-500">
                                    我们将回复至：{" "}
                                    <span className="font-medium">
                                        {user.email}
                                    </span>
                                </div>
                            )}

                            {/* Error Message */}
                            {error && (
                                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                                    {error}
                                </div>
                            )}

                            {/* Submit Button */}
                            <button
                                type="submit"
                                disabled={
                                    isSubmitting ||
                                    !subject.trim() ||
                                    !message.trim()
                                }
                                className="w-full py-3 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
                            >
                                {isSubmitting ? (
                                    <>
                                        <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        <span>发送中...</span>
                                    </>
                                ) : (
                                    <>
                                        <Send className="h-4 w-4" />
                                        <span>提交</span>
                                    </>
                                )}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
}
