import Link from "next/link";

export default function NotFound() {
    return (
        <div className="min-h-screen bg-white flex items-center justify-center px-4">
            <div className="text-center max-w-md">
                <h1 className="text-3xl font-eb-garamond font-light text-gray-900 mb-3">
                    页面未找到
                </h1>
                <p className="text-[0.9375rem] text-gray-500 leading-relaxed mb-8">
                    您访问的页面不存在，或可能已被移动。
                </p>

                <Link
                    href="/"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium text-white bg-gray-900 hover:bg-gray-700 transition-colors"
                >
                    返回首页
                </Link>
            </div>
        </div>
    );
}
