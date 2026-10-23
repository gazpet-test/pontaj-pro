import unittest
from ocr_local.e3_perspectiva import perspectiva


class PerspectiveTests(unittest.TestCase):
    def setUp(self):
        try:
            import cv2
            import numpy as np
            from PIL import Image
        except ImportError:
            self.skipTest('OpenCV/numpy/Pillow absente; fără instalări de rețea')
        self.cv, self.np, self.Image = cv2, np, Image

    def test_white_trapezoidal_table_not_sheet_preserves_header_totals(self):
        cv, np = self.cv, self.np
        img = np.full((800,1000,3),255,dtype=np.uint8)
        cv.polylines(img,[np.int32([[100,150],[900,190],[850,650],[150,650]])],True,(0,0,0),3)
        cv.putText(img,'FURNIZOR',(300,80),cv.FONT_HERSHEY_SIMPLEX,1,(255,0,0),3)
        cv.putText(img,'TOTAL',(300,750),cv.FONT_HERSHEY_SIMPLEX,1,(0,0,255),3)
        original = self.Image.fromarray(img)
        result, state = perspectiva(original)
        self.assertEqual(state,'nesigura')
        self.assertIs(result,original)
        self.assertTrue(np.array_equal(np.asarray(result)[:100],img[:100]))
        self.assertTrue(np.array_equal(np.asarray(result)[700:],img[700:]))

    def test_proven_sheet_warps_whole_frame_keeps_outside_markers(self):
        cv, np = self.cv, self.np
        img = np.full((1000,1000,3),40,dtype=np.uint8)
        cv.fillConvexPoly(img,np.int32([[100,160],[880,100],[830,850],[180,900]]),(245,245,245))
        cv.rectangle(img,(300,15),(600,40),(255,0,0),-1)
        cv.rectangle(img,(300,950),(600,975),(0,0,255),-1)
        result, state = perspectiva(self.Image.fromarray(img))
        self.assertEqual(state,'aplicata')
        arr=np.asarray(result)
        self.assertLessEqual(result.width*result.height,25000000)
        self.assertGreater(np.sum((arr[:,:,0]>200)&(arr[:,:,1]<80)&(arr[:,:,2]<80)),100)
        self.assertGreater(np.sum((arr[:,:,2]>200)&(arr[:,:,0]<80)&(arr[:,:,1]<80)),100)

    def test_rectangular_proven_sheet_is_useless(self):
        img=self.np.full((800,1000,3),40,dtype=self.np.uint8)
        self.cv.rectangle(img,(100,100),(900,700),(245,245,245),-1)
        original=self.Image.fromarray(img)
        result,state=perspectiva(original)
        self.assertEqual(state,'inutila')
        self.assertIs(result,original)
