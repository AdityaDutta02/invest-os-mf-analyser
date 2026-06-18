// RECOVERED verbatim from original Emergent app sourcemap. Reference only.
// Shows the original API contract (multipart upload to /api/analyse and /api/compare).
// NOTE: new app replaces this with mfapi search + /api/analyse?scheme=&period= (GET from DB),
// keeping POST /api/upload for the escape-hatch. See ARCHITECTURE.md.
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const analysePdf = async (file) => {
  const form = new FormData();
  form.append("file", file);
  const res = await axios.post(`${API}/analyse`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
};

export const comparePdfs = async (fileA, fileB) => {
  const form = new FormData();
  form.append("file_a", fileA);
  form.append("file_b", fileB);
  const res = await axios.post(`${API}/compare`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data;
};
