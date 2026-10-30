module.exports = () => async (req, res) => {
    const code = req.query.code;
    if (!code) {
        return res.redirect("/portal?error=missing_code");
    }
    return res.redirect(`/portal?code=${encodeURIComponent(code)}`);
};
